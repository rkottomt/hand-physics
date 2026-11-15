// Boundary tests for starsFor() in js/game.js. (game.test.mjs only checks 5, 15 and 25 s.)
//   npm test
import test from "node:test";
import assert from "node:assert/strict";
import MatterLib from "matter-js";

globalThis.Matter = MatterLib; // game.js expects the browser global
const { starsFor } = await import("../js/game.js");

test("starsFor: exactly par is 3 stars, just over is 2", () => {
  assert.equal(starsFor(8, 8), 3);
  assert.equal(starsFor(8.001, 8), 2);
});

test("starsFor: exactly 2x par is 2 stars, just over is 1", () => {
  assert.equal(starsFor(16, 8), 2);
  assert.equal(starsFor(16.001, 8), 1);
});
