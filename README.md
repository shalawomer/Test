# Clearwave

A self-hosted web app for removing noise from audio and video. Upload a recording
through the browser, the server cleans it, and you get the file back — no external
API, no account, nothing leaves the machine you run it on.

![Clearwave](https://img.shields.io/badge/node-%E2%89%A518-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

## Run it

```bash
npm install
npm start
# open http://localhost:3000
```

FFmpeg ships with the install (`ffmpeg-static`) — there is nothing else to set up.

### Configuration

| Variable            | Default | Meaning                                  |
| ------------------- | ------- | ---------------------------------------- |
| `PORT`              | `3000`  | HTTP port                                |
| `MAX_UPLOAD_MB`     | `500`   | Largest accepted upload                  |
| `FILE_TTL_MINUTES`  | `60`    | How long uploads and results are kept     |

## What it does to the audio

The enhancement is a single FFmpeg filter chain (`buildFilterChain` in `server.js`):

1. `highpass=f=80` — removes rumble, handling thumps, and mains hum.
2. `afftdn` — FFT spectral denoise with noise tracking (`tn=1`), the main noise removal stage.
3. `anlmdn` — non-local-means pass that clears the broadband residue `afftdn` leaves behind.
4. `deesser` + `lowpass=f=15000` — tames sibilance and the harsh top end.
5. `acompressor` — evens out quiet and loud passages.
6. `loudnorm` (or `speechnorm`) + `alimiter` — normalizes to −16 LUFS, the podcast standard, and prevents clipping.

Three strength presets (Light / Balanced / Strong) scale the denoise depth; an
optional room-echo pass adds a fast-release downward expander that pulls reverb
tails under the speech. On a test file of a tone buried in pink noise, the Strong
preset drops noise-band energy by about 13 dB.

**Output:** audio in → 48 kHz 16-bit WAV. Video in → MP4 with the original video
stream copied bit-for-bit and a new 192 kbps AAC track (falls back to re-encoding
video only if the source codec cannot be stored in MP4).

**Accepted input:** MP3, WAV, M4A, AAC, FLAC, OGG, OPUS, WMA, AIFF, MP4, MOV, MKV,
WEBM, AVI, WMV, FLV, MPEG.

## API

| Method   | Route                | Purpose                                                        |
| -------- | -------------------- | -------------------------------------------------------------- |
| `POST`   | `/api/enhance`       | Multipart `file`, plus `strength`, `dereverb`, `normalize`. Returns a job id. |
| `GET`    | `/api/status/:id`    | `{ status, progress, durationSec, outputBytes, … }`             |
| `GET`    | `/api/original/:id`  | The uploaded file, for A/B comparison                           |
| `GET`    | `/api/result/:id`    | The enhanced file (`?download=1` for a download header)         |
| `DELETE` | `/api/job/:id`       | Cancel processing and delete both files immediately             |

## Privacy

Files live on disk only for `FILE_TTL_MINUTES` (one hour by default); a sweeper
deletes anything older, and the **New file** button deletes the pair right away.
Job state is in memory, so a restart drops everything.

## Notes

Clearwave is an independent project and is not affiliated with, endorsed by, or
derived from Adobe Podcast or any Adobe product.

## License

MIT
