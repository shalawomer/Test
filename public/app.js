'use strict';

const $ = (id) => document.getElementById(id);

const stages = { upload: $('stage-upload'), progress: $('stage-progress'), result: $('stage-result') };
const dropzone = $('dropzone');
const fileInput = $('file-input');
const uploadError = $('upload-error');
const barFill = $('bar-fill');
const barPct = $('bar-pct');
const procName = $('proc-name');
const procStep = $('proc-step');
const playerWrap = $('player-wrap');

const state = { jobId: null, kind: 'audio', poll: null, xhr: null, source: 'enhanced' };

function showStage(name) {
  for (const [key, el] of Object.entries(stages)) el.hidden = key !== name;
}

function setProgress(pct, label) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  barFill.style.width = `${value}%`;
  barPct.textContent = `${value}%`;
  if (label) procStep.textContent = label;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showError(message) {
  uploadError.textContent = message;
  uploadError.hidden = false;
  showStage('upload');
}

/* ---------------- file selection ---------------- */

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) startUpload(fileInput.files[0]);
});

for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
}
for (const type of ['dragleave', 'drop']) {
  dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); });
}
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) startUpload(file);
});
// Dropping anywhere else must not navigate away from the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

/* ---------------- options ---------------- */

const strengthGroup = $('strength');
strengthGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  for (const b of strengthGroup.querySelectorAll('button')) {
    const on = b === btn;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
});
const currentStrength = () => strengthGroup.querySelector('button.on').dataset.value;

/* ---------------- upload + poll ---------------- */

function startUpload(file) {
  uploadError.hidden = true;
  procName.textContent = file.name;
  setProgress(0, 'Uploading…');
  showStage('progress');

  const form = new FormData();
  form.append('file', file);
  form.append('strength', currentStrength());
  form.append('dereverb', String($('dereverb').checked));
  form.append('normalize', String($('normalize').checked));

  const xhr = new XMLHttpRequest();
  state.xhr = xhr;
  xhr.open('POST', '/api/enhance');

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) setProgress((e.loaded / e.total) * 100, 'Uploading…');
  });

  xhr.addEventListener('load', () => {
    state.xhr = null;
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch { /* handled below */ }
    if (xhr.status !== 200) return showError(data.error || 'Upload failed. Please try again.');
    state.jobId = data.id;
    state.kind = data.kind;
    setProgress(0, 'Removing noise…');
    pollStatus();
  });

  xhr.addEventListener('error', () => { state.xhr = null; showError('Network error during upload.'); });
  xhr.addEventListener('abort', () => { state.xhr = null; });
  xhr.send(form);
}

function pollStatus() {
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    if (!state.jobId) return;
    let job;
    try {
      const res = await fetch(`/api/status/${state.jobId}`);
      job = await res.json();
      if (!res.ok) throw new Error(job.error || 'Job not found.');
    } catch (err) {
      clearInterval(state.poll);
      return showError(err.message);
    }
    if (job.status === 'error') {
      clearInterval(state.poll);
      return showError(`Could not process this file: ${job.error || 'unknown error'}`);
    }
    setProgress(job.progress, job.progress > 0 ? 'Removing noise…' : 'Analyzing the noise floor…');
    if (job.status === 'done') {
      clearInterval(state.poll);
      showResult(job);
    }
  }, 600);
}

/* ---------------- result ---------------- */

function showResult(job) {
  setProgress(100, 'Done');
  $('result-name').textContent = job.downloadName;
  $('download-btn').href = `/api/result/${job.id}?download=1`;
  $('download-btn').setAttribute('download', job.downloadName);

  const parts = [];
  if (job.durationSec) parts.push(`Length ${formatDuration(job.durationSec)}`);
  if (job.inputBytes) parts.push(`Original ${formatBytes(job.inputBytes)}`);
  if (job.outputBytes) parts.push(`Enhanced ${formatBytes(job.outputBytes)}`);
  parts.push('Files are deleted automatically after one hour.');
  $('result-meta').textContent = parts.join(' · ');

  state.source = 'enhanced';
  syncSwitch();
  buildPlayer(0, false);
  showStage('result');
}

function srcFor(source) {
  return source === 'original' ? `/api/original/${state.jobId}` : `/api/result/${state.jobId}`;
}

/**
 * The two sources are different files, so a single element is re-pointed and
 * re-seeked rather than crossfaded — that keeps the comparison on the same
 * moment of the recording when you flip the switch mid-playback.
 */
function buildPlayer(atTime, autoplay) {
  const el = document.createElement(state.kind === 'video' ? 'video' : 'audio');
  el.controls = true;
  el.preload = 'metadata';
  el.src = srcFor(state.source);
  el.addEventListener('loadedmetadata', () => {
    if (atTime > 0 && Number.isFinite(el.duration)) el.currentTime = Math.min(atTime, el.duration - 0.05);
    if (autoplay) el.play().catch(() => { /* autoplay may be blocked; controls still work */ });
  }, { once: true });
  playerWrap.replaceChildren(el);
  return el;
}

function currentPlayer() { return playerWrap.firstElementChild; }

function syncSwitch() {
  for (const b of document.querySelectorAll('.ab-switch button')) {
    const on = b.dataset.src === state.source;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
}

document.querySelector('.ab-switch').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.dataset.src === state.source) return;
  const player = currentPlayer();
  const at = player ? player.currentTime : 0;
  const wasPlaying = player ? !player.paused : false;
  state.source = btn.dataset.src;
  syncSwitch();
  buildPlayer(at, wasPlaying);
});

/* ---------------- reset / cancel ---------------- */

function reset(deleteOnServer) {
  clearInterval(state.poll);
  if (state.xhr) state.xhr.abort();
  if (deleteOnServer && state.jobId) {
    navigator.sendBeacon
      ? fetch(`/api/job/${state.jobId}`, { method: 'DELETE', keepalive: true }).catch(() => {})
      : null;
  }
  state.jobId = null;
  playerWrap.replaceChildren();
  fileInput.value = '';
  uploadError.hidden = true;
  setProgress(0, 'Uploading…');
  showStage('upload');
}

$('again-btn').addEventListener('click', () => reset(true));
$('cancel-btn').addEventListener('click', () => reset(true));
