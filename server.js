'use strict';

const express = require('express');
const multer = require('multer');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024;
const FILE_TTL_MS = Number(process.env.FILE_TTL_MINUTES || 60) * 60 * 1000;

for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) fs.mkdirSync(dir, { recursive: true });

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wma', '.aiff', '.aif']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.wmv', '.flv', '.mpeg', '.mpg']);

/** In-memory job registry. id -> job */
const jobs = new Map();

const upload = multer({
  limits: { fileSize: MAX_BYTES, files: 1 },
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type "${ext || 'unknown'}". Upload audio or video.`));
  },
});

/**
 * Build the enhancement filter chain.
 *
 * afftdn does the spectral denoise (the heavy lifting), anlmdn cleans up the
 * broadband hiss afftdn leaves behind, and the rest is the speech-shaping the
 * denoise stages expose: rumble out, sibilance tamed, level made consistent.
 */
function buildFilterChain({ strength, dereverb, normalize }) {
  const presets = {
    light: { nr: 10, nf: -30, nlm: 0.00008, gate: null },
    medium: { nr: 18, nf: -25, nlm: 0.0002, gate: null },
    strong: { nr: 28, nf: -20, nlm: 0.0004, gate: '-38' },
  };
  const p = presets[strength] || presets.medium;
  const chain = [
    'highpass=f=80',
    `afftdn=nr=${p.nr}:nf=${p.nf}:tn=1`,
  ];
  if (p.gate) chain.push(`agate=threshold=0.008:ratio=2:attack=10:release=250:makeup=1`);
  chain.push(`anlmdn=s=${p.nlm}:p=0.002:r=0.006`);
  if (dereverb) {
    // Reverb is the decaying tail after each syllable, so a fast-release downward
    // expander pulls it under while the syllable itself stays above the threshold.
    chain.push('agate=threshold=0.02:ratio=1.6:attack=5:release=120:knee=4');
  }
  chain.push('deesser=i=0.35', 'lowpass=f=15000');
  chain.push('acompressor=threshold=-20dB:ratio=3:attack=15:release=250:makeup=2');
  chain.push(normalize ? 'loudnorm=I=-16:TP=-1.5:LRA=11' : 'speechnorm=e=6.25:r=0.00001:l=1');
  chain.push('alimiter=limit=0.98');
  return chain.join(',');
}

function ffmpegArgs(job) {
  const filters = buildFilterChain(job.options);
  const args = ['-hide_banner', '-nostdin', '-y', '-i', job.inputPath, '-af', filters];
  if (job.kind === 'video') {
    args.push('-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart');
  } else {
    args.push('-map', '0:a:0', '-c:a', 'pcm_s16le', '-ar', '48000');
  }
  args.push('-progress', 'pipe:1', '-nostats', job.outputPath);
  return args;
}

function runFfmpeg(job, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    job.proc = proc;
    let stderr = '';

    proc.stdout.on('data', (buf) => {
      for (const line of buf.toString().split('\n')) {
        const [key, value] = line.split('=');
        if (key === 'out_time_us' && job.durationSec > 0) {
          const done = Number(value) / 1e6;
          if (Number.isFinite(done)) {
            job.progress = Math.min(99, Math.round((done / job.durationSec) * 100));
          }
        }
      }
    });

    proc.stderr.on('data', (buf) => {
      const text = buf.toString();
      stderr = (stderr + text).slice(-8000);
      if (!job.durationSec) {
        const m = text.match(/Duration:\s*(\d+):(\d\d):(\d\d\.\d+)/);
        if (m) job.durationSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      }
    });

    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))));
  });
}

async function processJob(job) {
  job.status = 'processing';
  try {
    await runFfmpeg(job, ffmpegArgs(job));
  } catch (err) {
    // Stream copy fails when the source video codec cannot live in MP4
    // (VP9/WebM, some MPEG-4 variants). Re-encode the video once before giving up.
    if (job.kind === 'video' && !job.retried) {
      job.retried = true;
      job.progress = 0;
      const args = ffmpegArgs(job).map((a) => a);
      const i = args.indexOf('copy');
      if (i !== -1) args.splice(i, 1, 'libx264', '-preset', 'veryfast', '-crf', '20');
      try {
        await runFfmpeg(job, args);
      } catch (err2) {
        job.status = 'error';
        job.error = String(err2.message || err2).split('\n').slice(-3).join(' ');
        return;
      }
    } else {
      job.status = 'error';
      job.error = String(err.message || err).split('\n').slice(-3).join(' ');
      return;
    }
  }
  job.progress = 100;
  job.status = 'done';
  job.finishedAt = Date.now();
  try {
    job.outputBytes = fs.statSync(job.outputPath).size;
  } catch { /* stat is cosmetic */ }
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/enhance', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `File is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)} MB limit.`
        : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const ext = path.extname(req.file.filename).toLowerCase();
    const kind = VIDEO_EXT.has(ext) ? 'video' : 'audio';
    const id = crypto.randomUUID();
    const baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const outExt = kind === 'video' ? '.mp4' : '.wav';

    const job = {
      id,
      kind,
      status: 'queued',
      progress: 0,
      durationSec: 0,
      createdAt: Date.now(),
      originalName: req.file.originalname,
      downloadName: `${baseName}-enhanced${outExt}`.replace(/[/\\?%*:|"<>]/g, '_'),
      inputPath: req.file.path,
      inputBytes: req.file.size,
      outputPath: path.join(OUTPUT_DIR, `${id}${outExt}`),
      options: {
        strength: ['light', 'medium', 'strong'].includes(req.body.strength) ? req.body.strength : 'medium',
        dereverb: req.body.dereverb === 'true',
        normalize: req.body.normalize !== 'false',
      },
    };
    jobs.set(id, job);
    processJob(job);

    res.json({ id, kind, originalName: job.originalName, options: job.options });
  });
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  res.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    error: job.error,
    durationSec: job.durationSec,
    inputBytes: job.inputBytes,
    outputBytes: job.outputBytes,
    downloadName: job.downloadName,
  });
});

function sendFile(res, filePath, { download, name }) {
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File expired. Please upload again.' });
  res.sendFile(filePath, {
    headers: download ? { 'Content-Disposition': `attachment; filename="${name}"` } : {},
  });
}

app.get('/api/original/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  sendFile(res, job.inputPath, { download: false });
});

app.get('/api/result/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  if (job.status !== 'done') return res.status(409).json({ error: 'Still processing.' });
  sendFile(res, job.outputPath, { download: req.query.download === '1', name: job.downloadName });
});

app.delete('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) cleanupJob(job);
  res.json({ ok: true });
});

function cleanupJob(job) {
  if (job.proc && job.status === 'processing') job.proc.kill('SIGKILL');
  for (const p of [job.inputPath, job.outputPath]) fs.rm(p, { force: true }, () => {});
  jobs.delete(job.id);
}

// Uploads are transient: nothing survives more than FILE_TTL_MS.
setInterval(() => {
  const cutoff = Date.now() - FILE_TTL_MS;
  for (const job of jobs.values()) if (job.createdAt < cutoff) cleanupJob(job);
}, 5 * 60 * 1000).unref();

if (require.main === module) {
  app.listen(PORT, () => console.log(`Clearwave listening on http://localhost:${PORT}`));
}

module.exports = { app, buildFilterChain };
