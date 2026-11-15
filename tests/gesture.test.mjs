// Exact-value tests for js/gesture.js that the other test files don't already cover.
// (pinch.test.mjs covers 0.35 from open, 0.5 from held, and the collapsed hand.)
//   npm test
import test from "node:test";
import assert from "node:assert/strict";
import { nextPinch, coverMap } from "../js/gesture.js";

test("nextPinch: at exactly 0.35 or 0.5, hysteresis keeps the previous state", () => {
  assert.equal(nextPinch(true, 0.35), true);  // held pinch doesn't let go at the ON threshold
  assert.equal(nextPinch(false, 0.5), false); // open hand doesn't close at the OFF threshold
});

test("coverMap: wide 16:9 video is cropped left and right", () => {
  // 1280x720 on 960x720: scale 1, 160 px cut off each side.
  assert.deepEqual(coverMap(0.5, 0.5, 1280, 720, 960, 720), { x: 480, y: 360 });
  assert.deepEqual(coverMap(0, 0, 1280, 720, 960, 720), { x: -160, y: 0 });
  assert.deepEqual(coverMap(1, 1, 1280, 720, 960, 720), { x: 1120, y: 720 });
  assert.deepEqual(coverMap(0.25, 0.75, 1280, 720, 960, 720), { x: 160, y: 540 });
});

test("coverMap: tall portrait video is cropped top and bottom", () => {
  // 480x640 on 960x720: scale 2, displayed 960x1280, 280 px cut off top and bottom.
  assert.deepEqual(coverMap(0.5, 0.5, 480, 640, 960, 720), { x: 480, y: 360 });
  assert.deepEqual(coverMap(0, 0, 480, 640, 960, 720), { x: 0, y: -280 });
  assert.deepEqual(coverMap(1, 1, 480, 640, 960, 720), { x: 960, y: 1000 });
  assert.deepEqual(coverMap(0.25, 0.75, 480, 640, 960, 720), { x: 240, y: 680 });
});
