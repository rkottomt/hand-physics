// Pure gesture math (no camera, no DOM) so it can be unit-tested in Node.
// MediaPipe gives 21 landmarks per hand: 0 = wrist, 4 = thumb tip, 8 = index tip, 9 = middle knuckle.

// Pinch = thumb tip and index tip close together. Two thresholds (hysteresis) stop
// the grab from flickering on/off when the fingers hover right at the boundary.
export const PINCH_ON = 0.35;
export const PINCH_OFF = 0.5;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Thumb-index gap divided by hand size, so it works whether your hand is near or far.
export function pinchRatio(landmarks) {
  const handSize = dist(landmarks[0], landmarks[9]);
  return handSize > 0 ? dist(landmarks[4], landmarks[8]) / handSize : Infinity;
}

export function nextPinch(wasPinching, ratio) {
  return wasPinching ? ratio < PINCH_OFF : ratio < PINCH_ON;
}

// Exponential smoothing: removes camera jitter but still follows fast throws.
export function smooth(prev, next, alpha = 0.6) {
  if (!prev) return next;
  return { x: prev.x + (next.x - prev.x) * alpha, y: prev.y + (next.y - prev.y) * alpha };
}

// Map a normalized (0..1) video point to canvas pixels, matching CSS `object-fit: cover`
// so the drawn hand lines up with the video behind it.
export function coverMap(nx, ny, videoW, videoH, canvasW, canvasH) {
  const scale = Math.max(canvasW / videoW, canvasH / videoH);
  const dispW = videoW * scale, dispH = videoH * scale;
  return {
    x: (canvasW - dispW) / 2 + nx * dispW,
    y: (canvasH - dispH) / 2 + ny * dispH,
  };
}
