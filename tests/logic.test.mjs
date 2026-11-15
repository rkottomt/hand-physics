// Unit tests for the pure decision logic in js/logic.js.
//   npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  handFrameStep, initialHandState, cursorFromLandmarks, pickBetterResult,
} from "../js/logic.js";

// A visible-hand frame. Defaults: pinching, not holding anything, cursor within reach.
const hand = (o = {}) => ({ pinching: true, holdingWithHand: false, somethingHeld: false, canReach: true, ...o });
const holding = (o = {}) => hand({ holdingWithHand: true, somethingHeld: true, ...o });

// Pinch at t=0 and pretend the grab succeeded: returns the state while holding.
function grabbedAtZero() {
  const r = handFrameStep(initialHandState(), hand(), 0);
  assert.equal(r.action, "grab");
  return r.state;
}

// ---------- cursorFromLandmarks ----------

test("cursorFromLandmarks: midpoint, with x mirrored exactly once", () => {
  // Thumb and index both on the left of the camera image -> cursor on the right of the screen.
  const c = cursorFromLandmarks({ x: 0.125, y: 0.25 }, { x: 0.375, y: 0.75 });
  assert.deepEqual(c, { x: 0.75, y: 0.5 }); // not mirrored, or mirrored twice, would give x = 0.25
});

test("cursorFromLandmarks: y is not mirrored", () => {
  assert.deepEqual(cursorFromLandmarks({ x: 0.5, y: 0 }, { x: 0.5, y: 0.25 }), { x: 0.5, y: 0.125 });
});

// ---------- handFrameStep: tracking dropouts ----------

test("handFrameStep: a 249 ms dropout keeps holding, 251 ms releases", () => {
  let s = grabbedAtZero();
  let r = handFrameStep(s, null, 1000); // hand disappears
  assert.equal(r.action, "none");
  assert.deepEqual(r.state, { wasPinching: true, pinchStartedAt: 0, handLostAt: 1000 });
  s = r.state;

  r = handFrameStep(s, null, 1249);
  assert.equal(r.action, "none");
  assert.deepEqual(r.state, { wasPinching: true, pinchStartedAt: 0, handLostAt: 1000 });

  // Hand comes back after 249 ms, still pinching: it carries on moving the body.
  assert.equal(handFrameStep(r.state, holding(), 1249).action, "move");

  r = handFrameStep(s, null, 1251);
  assert.equal(r.action, "lost");
  assert.deepEqual(r.state, { wasPinching: false, pinchStartedAt: 0, handLostAt: 1000 });
});

test("handFrameStep: handLostAt resets when the hand returns", () => {
  let s = grabbedAtZero();
  s = handFrameStep(s, null, 1000).state;          // dropout starts
  const back = handFrameStep(s, holding(), 1200);  // hand returns
  assert.equal(back.action, "move");
  assert.equal(back.state.handLostAt, null);

  s = handFrameStep(back.state, null, 1300).state; // second, short dropout
  assert.equal(s.handLostAt, 1300);
  // 100 ms into the new dropout (400 ms after the first one began): still holding.
  assert.equal(handFrameStep(s, null, 1400).action, "none");
});

// ---------- handFrameStep: grab / move / release ----------

test("handFrameStep: late grab fires within 300 ms of the pinch starting, not after", () => {
  // Pinch at t=0 over empty space: grab is attempted but nothing gets held.
  const s = handFrameStep(initialHandState(), hand(), 0).state;
  assert.deepEqual(s, { wasPinching: true, pinchStartedAt: 0, handLostAt: null });

  assert.equal(handFrameStep(s, hand(), 100).action, "grab");
  assert.equal(handFrameStep(s, hand(), 299).action, "grab");
  assert.equal(handFrameStep(s, hand(), 300).action, "none");
  // Within the window but past the red line, or with something already held: no grab.
  assert.equal(handFrameStep(s, hand({ canReach: false }), 100).action, "none");
  assert.equal(handFrameStep(s, hand({ somethingHeld: true }), 100).action, "none");
});

test("handFrameStep: after a release, the late grab doesn't fire until a new pinch starts", () => {
  let s = grabbedAtZero();
  s = handFrameStep(s, holding(), 50).state;

  let r = handFrameStep(s, hand({ pinching: false }), 100); // open hand: let go
  assert.equal(r.action, "release");
  assert.equal(r.state.wasPinching, false);

  // Hand stays open, still inside the original pinch's 300 ms window: nothing is grabbed.
  r = handFrameStep(r.state, hand({ pinching: false }), 150);
  assert.equal(r.action, "none");

  // A new pinch is a fresh grab, and the late-grab window restarts from it.
  r = handFrameStep(r.state, hand(), 400);
  assert.equal(r.action, "grab");
  assert.deepEqual(r.state, { wasPinching: true, pinchStartedAt: 400, handLostAt: null });
  assert.equal(handFrameStep(r.state, hand(), 699).action, "grab");
  assert.equal(handFrameStep(r.state, hand(), 700).action, "none");
});

// ---------- pickBetterResult ----------

test("pickBetterResult: more stars beats a faster time", () => {
  const slow3 = { stars: 3, seconds: 50 };
  const fast2 = { stars: 2, seconds: 10 };
  assert.equal(pickBetterResult(fast2, slow3), slow3);
  assert.equal(pickBetterResult(slow3, fast2), slow3);
});

test("pickBetterResult: equal stars, the faster time wins; a full tie keeps the existing one", () => {
  const existing = { stars: 2, seconds: 20 };
  const faster = { stars: 2, seconds: 15 };
  const slower = { stars: 2, seconds: 25 };
  const same = { stars: 2, seconds: 20 };
  assert.equal(pickBetterResult(existing, faster), faster);
  assert.equal(pickBetterResult(existing, slower), existing);
  assert.equal(pickBetterResult(existing, same), existing);
  assert.equal(pickBetterResult(undefined, slower), slower); // first result on a level
});

test("pickBetterResult: does not mutate its inputs", () => {
  const existing = Object.freeze({ stars: 1, seconds: 30 });
  const candidate = Object.freeze({ stars: 3, seconds: 40 });
  const kept = pickBetterResult(existing, candidate); // frozen: any write would throw
  assert.equal(kept, candidate);
  assert.deepEqual(existing, { stars: 1, seconds: 30 });
  assert.deepEqual(candidate, { stars: 3, seconds: 40 });
});
