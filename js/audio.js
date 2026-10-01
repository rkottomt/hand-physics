// Tiny synthesized sound effects with the Web Audio API (no audio files to load).
let ctx = null;
let muted = false;
let lastHit = 0;

export function setMuted(value) { muted = value; }

// Browsers only allow audio after a user gesture, so call this from click handlers.
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
  } catch { /* audio is optional */ }
}

function tone(freq, duration, { type = "sine", volume = 0.15, slideTo } = {}) {
  if (muted || !ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

export const sfx = {
  grab: () => tone(500, 0.08, { type: "triangle", slideTo: 800 }),
  release: () => tone(650, 0.1, { type: "triangle", slideTo: 350, volume: 0.1 }),
  denied: () => tone(160, 0.15, { type: "square", volume: 0.06 }),
  respawn: () => tone(300, 0.15, { type: "sine", slideTo: 600, volume: 0.08 }),
  // Collision thud; louder for harder impacts, rate-limited so piles don't buzz.
  hit(impact) {
    const now = performance.now();
    if (now - lastHit < 45) return;
    lastHit = now;
    tone(70 + Math.random() * 60, 0.09, { type: "square", volume: Math.min(0.12, impact / 80) });
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => tone(f, 0.3, { type: "triangle", volume: 0.15 }), i * 110));
  },
};
