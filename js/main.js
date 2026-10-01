// Wires the hand tracker to the physics world and runs the "stack above the line" goal.
import { startHandTracking } from "./hand.js";
import { createWorld, loadLevel, blocks, handGrab, handMove, handRelease, isGrabbing,
         WIDTH, HEIGHT, GOAL_Y } from "./physics.js";

const canvas = document.getElementById("world");
const video = document.getElementById("video");
const statusEl = document.getElementById("status");
const goalText = document.getElementById("goalText");
const startBtn = document.getElementById("startCam");

const { engine, render, mouseConstraint } = createWorld(canvas);
loadLevel(engine, mouseConstraint);

let hand = null;        // latest hand reading, in canvas pixels
let heldSince = null;   // when a tower first got above the goal line
let won = false;
const HOLD_MS = 3000;

// ---- Hand input ----
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  statusEl.textContent = "Loading hand tracking model…";
  try {
    await startHandTracking(video, onHand);
    statusEl.textContent = "Show your hand! Pinch to grab a block.";
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    statusEl.textContent =
      err.name === "NotAllowedError"
        ? "Camera permission denied — you can still play with the mouse."
        : "Couldn't start the camera — you can still play with the mouse.";
  }
});

function onHand(h) {
  if (!h) {
    hand = null;
    handRelease(engine);
    return;
  }
  const x = h.x * WIDTH, y = h.y * HEIGHT;
  hand = { x, y, pinching: h.pinching };
  if (h.pinching) {
    handGrab(engine, x, y); // no-op if already holding something
    handMove(x, y);
  } else {
    handRelease(engine);
  }
}

// ---- Win condition + overlay drawing (runs after Matter draws each frame) ----
Matter.Events.on(render, "afterRender", () => {
  const ctx = render.context;

  // Goal line
  ctx.setLineDash([12, 10]);
  ctx.strokeStyle = "#ffffff88";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, GOAL_Y);
  ctx.lineTo(WIDTH, GOAL_Y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Hand cursor: hollow when open, filled when pinching
  if (hand) {
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = "#5b7cfa";
    ctx.strokeStyle = "#5b7cfa";
    ctx.lineWidth = 3;
    hand.pinching ? ctx.fill() : ctx.stroke();
  }

  if (!won) checkGoal();
});

function checkGoal() {
  // A block counts if it's above the line, resting (slow), and not being held.
  const resting = blocks(engine).filter(
    (b) => b.bounds.min.y < GOAL_Y && b.speed < 0.5
  );
  if (resting.length > 0 && !isGrabbing()) {
    heldSince ??= performance.now();
    const left = HOLD_MS - (performance.now() - heldSince);
    if (left <= 0) {
      won = true;
      goalText.textContent = "🎉 Tower complete!";
    } else {
      goalText.textContent = `Hold it… ${(left / 1000).toFixed(1)}`;
    }
  } else {
    heldSince = null;
    goalText.textContent = "";
  }
}

document.getElementById("reset").addEventListener("click", () => {
  handRelease(engine);
  loadLevel(engine, mouseConstraint);
  won = false;
  heldSince = null;
  goalText.textContent = "";
});
