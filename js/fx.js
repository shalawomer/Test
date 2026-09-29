/* Pocket Logic — feedback effects: synthesised sounds (Web Audio, no files), haptics, confetti. */
(function (PL) {
  'use strict';

  let ctx = null;
  let enabled = true;

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, at, dur, opts) {
    const a = audio();
    if (!a) return;
    const { type = 'sine', gain = 0.05, slide = 0 } = opts || {};
    const t = a.currentTime + at;
    const osc = a.createOscillator(), amp = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  const SOUNDS = {
    tap: () => tone(540, 0, 0.05, { type: 'triangle', gain: 0.03 }),
    good: () => { tone(660, 0, 0.12, { gain: 0.05 }); tone(990, 0.07, 0.18, { gain: 0.045 }); },
    hint: () => tone(700, 0, 0.22, { gain: 0.045, slide: 1.6 }),
    bad: () => tone(180, 0, 0.14, { type: 'square', gain: 0.025, slide: 0.75 }),
    win: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.4, { gain: 0.05 })),
  };
  const BUZZ = { good: 12, bad: [18, 40, 18], win: [30, 60, 30, 60, 80] };

  function confetti(colors) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    const parts = Array.from({ length: 150 }, (_, i) => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.25,
      y: H * 0.42,
      vx: (Math.random() - 0.5) * 13,
      vy: -Math.random() * 13 - 5,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.35,
      size: 6 + Math.random() * 7,
      color: colors[i % colors.length],
    }));
    const start = performance.now(), life = 2000;
    let last = start;
    (function frame(now) {
      const t = now - start, k = Math.min(3, (now - last) / 16.7);
      last = now;
      c.clearRect(0, 0, W, H);
      c.globalAlpha = Math.max(0, 1 - Math.max(0, t - life * 0.5) / (life * 0.5));
      for (const p of parts) {
        p.vy += 0.32 * k;
        p.vx *= Math.pow(0.985, k);
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.rot += p.vrot * k;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.color;
        c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        c.restore();
      }
      if (t < life) requestAnimationFrame(frame);
      else cv.remove();
    })(start);
  }

  PL.fx = {
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    play(name) {
      if (!enabled) return;
      try { if (SOUNDS[name]) SOUNDS[name](); } catch (_) { /* audio is optional */ }
      if (BUZZ[name] && navigator.vibrate) {
        try { navigator.vibrate(BUZZ[name]); } catch (_) { /* haptics are optional */ }
      }
    },
    confetti,
  };
})(globalThis.PL = globalThis.PL || {});
