// Boundary tests for the pinch detector in js/gesture.js.
// The existing test in game.test.mjs checks 0.3 / 0.4 / 0.55; these pin down the exact edges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pinchRatio, nextPinch, PINCH_ON, PINCH_OFF } from "../js/gesture.js";

// Build a 21-landmark hand: wrist at origin, knuckle `handSize` away, thumb/index `gap` apart.
function hand(gap, handSize = 1) {
  const pts = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  pts[9] = { x: 0, y: handSize };
  pts[4] = { x: 0, y: 0 };
  pts[8] = { x: gap, y: 0 };
  return pts;
}

test("exactly at PINCH_ON (0.35) does not start a pinch", () => {
  assert.equal(PINCH_ON, 0.35);
  assert.equal(nextPinch(false, 0.35), false);
  assert.equal(nextPinch(false, 0.3499), true);
});

test("exactly at PINCH_OFF (0.5) ends a held pinch", () => {
  assert.equal(PINCH_OFF, 0.5);
  assert.equal(nextPinch(true, 0.5), false);
  assert.equal(nextPinch(true, 0.4999), true);
});

test("ratio is scale-invariant: same gesture near or far gives the same ratio", () => {
  assert.equal(pinchRatio(hand(0.2, 1)), 0.2);
  assert.equal(pinchRatio(hand(0.4, 2)), 0.2);
});

test("collapsed hand (wrist == knuckle) gives Infinity and never pinches", () => {
  const r = pinchRatio(hand(0.1, 0));
  assert.equal(r, Infinity);
  assert.equal(nextPinch(false, r), false);
  assert.equal(nextPinch(true, r), false);
});