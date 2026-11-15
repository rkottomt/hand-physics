// Pure decision logic pulled out of main.js, hand.js and progress.js so it can be
// unit-tested in Node. No DOM, no clock, no globals, no sound, no storage:
// callers pass everything in and carry out the returned decision themselves.

export const HAND_LOST_GRACE_MS = 250; // tracking dropouts shorter than this don't drop the body
export const LATE_GRAB_MS = 300;       // a pinch this recent still grabs a shape you reach

export const initialHandState = () => ({ wasPinching: false, pinchStartedAt: 0, handLostAt: null });

// One hand-tracking frame -> { state, action }.
//   state:  { wasPinching, pinchStartedAt, handLostAt }  (returned as a new object)
//   frame:  null when no hand is visible, otherwise
//           { pinching, holdingWithHand, somethingHeld, canReach }
//           where the last three describe the game right now (canReach is for the cursor's x).
//   now:    current time in ms.
//   action: "none" | "lost" (forget the hand and release) | "grab" | "move" | "release"
export function handFrameStep(state, frame, now) {
  if (!frame) {
    const handLostAt = state.handLostAt ?? now;
    if (now - handLostAt > HAND_LOST_GRACE_MS) {
      return { state: { ...state, handLostAt, wasPinching: false }, action: "lost" };
    }
    return { state: { ...state, handLostAt }, action: "none" };
  }

  const next = { ...state, handLostAt: null, wasPinching: frame.pinching };
  let action = "none";
  if (frame.pinching) {
    if (!state.wasPinching) {
      next.pinchStartedAt = now;
      action = "grab";
    } else if (frame.holdingWithHand) {
      action = "move";
    } else if (!frame.somethingHeld && now - state.pinchStartedAt < LATE_GRAB_MS && frame.canReach) {
      action = "grab"; // forgiving: pinching just before reaching a shape still picks it up
    }
  } else if (state.wasPinching) {
    action = "release";
  }
  return { state: next, action };
}

// Cursor = midpoint of thumb tip and index tip, with x mirrored to match the mirrored video.
export function cursorFromLandmarks(thumb, index) {
  return { x: 1 - (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
}

// Which result to keep: more stars wins, then the faster time. Ties keep the existing one.
export function pickBetterResult(existing, candidate) {
  const better = !existing || candidate.stars > existing.stars ||
    (candidate.stars === existing.stars && candidate.seconds < existing.seconds);
  return better ? candidate : existing;
}
