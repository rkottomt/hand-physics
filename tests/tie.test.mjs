import { test } from "node:test";
import assert from "node:assert/strict";
import { qualifies } from "../js/leaderboard.js";

const board = (...secs) => secs.map((s, i) => ({ name: "p" + i, seconds: s }));

test("a time exactly tying 5th place qualifies for the board", () => {
  assert.equal(qualifies(board(1, 2, 3, 4, 5), 5), true);
});