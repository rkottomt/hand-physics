// Exact-value tests for cleanName() and validateSubmission() in api/_lib/leaderboard.mjs
// that leaderboard.test.mjs doesn't already cover.
//   npm test
import test from "node:test";
import assert from "node:assert/strict";
import { cleanName, validateSubmission } from "../api/_lib/leaderboard.mjs";

const NAME_ERROR = { error: "Names are 1-16 letters, numbers, spaces, _ . or -" };
const TIME_NAN = { error: "Time must be a number." };
const TIME_RANGE = { error: "That time isn't possible on this level." };

test("cleanName: punctuation-only and tab/newline-only names are rejected", () => {
  assert.equal(cleanName("..."), null);
  assert.equal(cleanName("\t \n"), null);
});

test("cleanName: 16 characters is allowed, counted after collapsing spaces", () => {
  assert.equal(cleanName("a".repeat(16)), "a".repeat(16));
  assert.equal(cleanName("abcdefgh     ijklmno"), "abcdefgh ijklmno"); // 20 raw, 16 after collapsing
  assert.equal(cleanName("abcdefgh  ijklmnop"), null);                // 17 after collapsing
});

test("cleanName: collapses tabs and newlines between words to one space", () => {
  assert.equal(cleanName("Ada\t\tLove\nlace"), "Ada Love lace");
});

test("validateSubmission: NaN and Infinity times are rejected", () => {
  for (const seconds of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(validateSubmission({ level: "hoop", name: "Ada", seconds }), TIME_NAN, String(seconds));
  }
});

test("validateSubmission: exactly the level's minimum is accepted, just under is not", () => {
  assert.deepEqual(validateSubmission({ level: "hoop", name: "Ada", seconds: 0.6 }),
    { level: "hoop", name: "Ada", seconds: 0.6 });
  assert.deepEqual(validateSubmission({ level: "hoop", name: "Ada", seconds: 0.599 }), TIME_RANGE);
});

test("validateSubmission: 3600 s is accepted, 3601 s is not", () => {
  assert.deepEqual(validateSubmission({ level: "tower", name: "Ada", seconds: 3600 }),
    { level: "tower", name: "Ada", seconds: 3600 });
  assert.deepEqual(validateSubmission({ level: "tower", name: "Ada", seconds: 3601 }), TIME_RANGE);
});

test("validateSubmission: returns the cleaned name and rejects '...'", () => {
  assert.deepEqual(validateSubmission({ level: "seesaw", name: "  Bo   Peep ", seconds: 12.34567 }),
    { level: "seesaw", name: "Bo Peep", seconds: 12.346 });
  assert.deepEqual(validateSubmission({ level: "seesaw", name: "...", seconds: 12 }), NAME_ERROR);
});
