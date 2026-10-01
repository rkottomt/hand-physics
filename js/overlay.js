// Everything drawn on top of the Matter.js bodies each frame: zones, goal line,
// the no-reach area, the hold-to-win bar, highlights, and the tracked hand.
import { WIDTH, HEIGHT } from "./constants.js";

// Pairs of MediaPipe landmark indices that form the hand's "bones".
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],         // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],         // index
  [5, 9], [9, 10], [10, 11], [11, 12],    // middle
  [9, 13], [13, 14], [14, 15], [15, 16],  // ring
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20], // pinky + palm
];

const ACCENT = "#7d9bff";

export function drawOverlay(ctx, game, view) {
  const t = performance.now() / 1000;

  // Area you can't reach into
  if (Number.isFinite(game.grabMaxX)) {
    ctx.fillStyle = view.deniedFlash > 0 ? "rgba(255,77,109,0.22)" : "rgba(255,77,109,0.08)";
    ctx.fillRect(game.grabMaxX, 0, WIDTH - game.grabMaxX, HEIGHT);
    dashedLine(ctx, game.grabMaxX, 0, game.grabMaxX, HEIGHT, "#ff4d6d");
    label(ctx, "OUT OF REACH →", game.grabMaxX + 12, 30, "#ff8fa3", "left");
  }

  // Target zones pulse gently so they read as "put it here"
  for (const z of game.zones) {
    const glow = 0.12 + 0.08 * Math.sin(t * 3);
    ctx.fillStyle = `rgba(91,192,168,${game.won ? 0.35 : glow})`;
    roundRect(ctx, z.x, z.y, z.w, z.h, 10);
    ctx.fill();
    ctx.strokeStyle = "#5bc0a8";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (z.label) label(ctx, z.label, z.x + z.w / 2, z.y + 26, "#9ff0d8", "center");
  }

  if (game.goalY !== null) {
    dashedLine(ctx, 0, game.goalY, WIDTH, game.goalY, "rgba(255,255,255,0.7)");
    label(ctx, "GOAL", 12, game.goalY - 10, "#ffffffcc", "left");
  }

  game.level?.draw?.(ctx, game.refs);

  // Outline the body you would grab, and the one you're holding
  const held = game.heldBody();
  if (held) outline(ctx, held, "#ffffff", 3);
  else if (view.hovered) outline(ctx, view.hovered, "rgba(255,255,255,0.6)", 2);

  // Hold-to-win progress bar
  if (game.holdProgress > 0 && !game.won) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, WIDTH / 2 - 150, 16, 300, 14, 7);
    ctx.fill();
    ctx.fillStyle = "#5bc0a8";
    roundRect(ctx, WIDTH / 2 - 150, 16, 300 * game.holdProgress, 14, 7);
    ctx.fill();
  }

  if (view.hand) drawHand(ctx, view.hand);
}

function drawHand(ctx, hand) {
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const [a, b] of BONES) {
    ctx.moveTo(hand.points[a].x, hand.points[a].y);
    ctx.lineTo(hand.points[b].x, hand.points[b].y);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  for (const p of hand.points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cursor ring shrinks as your fingers close, and fills in once you're pinching.
  const closeness = Math.min(1, Math.max(0, (hand.ratio - 0.3) / 0.9));
  const r = 10 + 22 * closeness;
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, hand.pinching ? 12 : r, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  if (hand.pinching) ctx.fill(); else ctx.stroke();
}

function outline(ctx, body, color, width) {
  // Compound bodies (none yet) keep their real shape in parts[1..]
  const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (const part of parts) {
    ctx.beginPath();
    part.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
    ctx.closePath();
    ctx.stroke();
  }
}

function dashedLine(ctx, x1, y1, x2, y2, color) {
  ctx.save();
  ctx.setLineDash([12, 10]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function label(ctx, text, x, y, color, align) {
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(w, 0), h, Math.min(r, w / 2, h / 2));
}
