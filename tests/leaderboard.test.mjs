// Leaderboard API tests: the real request handlers on top of an in-memory Redis.
//   npm test
import test from "node:test";
import assert from "node:assert/strict";
import { createHandlers, makeLeaderboard, upstash, cleanName, LEVEL_MIN_SECONDS, TOP_N }
  from "../api/_lib/leaderboard.mjs";
import { memoryRedis } from "../api/_lib/memory-redis.mjs";
import { qualifies } from "../js/leaderboard.js";
import { LEVELS } from "../js/levels.js";

function setup() {
  const board = makeLeaderboard(memoryRedis());
  const api = createHandlers(() => board);
  let ip = 0;
  return {
    get: async (query = "") => {
      const res = await api.GET(new Request(`http://x/api/leaderboard${query}`));
      return { status: res.status, body: await res.json() };
    },
    post: async (body, { from = `10.0.0.${ip++}` } = {}) => {
      const res = await api.POST(new Request("http://x/api/leaderboard", {
        method: "POST",
        headers: { "x-forwarded-for": from },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }));
      return { status: res.status, body: await res.json() };
    },
  };
}

test("server's level list matches the timed levels in js/levels.js", () => {
  const timed = LEVELS.filter((l) => !l.sandbox);
  assert.deepEqual(Object.keys(LEVEL_MIN_SECONDS).sort(), timed.map((l) => l.id).sort());
  for (const l of timed) assert.equal(LEVEL_MIN_SECONDS[l.id], l.holdMs / 1000, `${l.id} minimum time`);
});

test("a submitted time shows up on that level's board", async () => {
  const lb = setup();
  const res = await lb.post({ level: "hoop", name: "Ada", seconds: 7.12345 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { entries: [{ name: "Ada", seconds: 7.123 }], rank: 1 });

  const all = await lb.get();
  assert.deepEqual(all.body.boards.hoop, [{ name: "Ada", seconds: 7.123 }]);
  assert.deepEqual(all.body.boards.tower, []);
  assert.deepEqual(Object.keys(all.body.boards).sort(), Object.keys(LEVEL_MIN_SECONDS).sort());

  const one = await lb.get("?level=hoop");
  assert.deepEqual(Object.keys(one.body.boards), ["hoop"]);
});

test("keeps only the 5 fastest, fastest first", async () => {
  const lb = setup();
  const times = [20, 9, 14, 30, 11, 25, 8];
  for (const [i, s] of times.entries()) await lb.post({ level: "tower", name: `P${i}`, seconds: s });
  const { body } = await lb.get("?level=tower");
  assert.deepEqual(body.boards.tower.map((e) => e.seconds), [8, 9, 11, 14, 20]);

  const slow = await lb.post({ level: "tower", name: "Slowpoke", seconds: 21 });
  assert.equal(slow.body.rank, null, "didn't make the top 5");
  assert.equal(slow.body.entries.length, TOP_N);
});

test("each player keeps only their best time", async () => {
  const lb = setup();
  await lb.post({ level: "seesaw", name: "Bo", seconds: 20 });
  const worse = await lb.post({ level: "seesaw", name: "Bo", seconds: 25 });
  assert.deepEqual(worse.body.entries, [{ name: "Bo", seconds: 20 }]);
  const better = await lb.post({ level: "seesaw", name: "Bo", seconds: 15 });
  assert.deepEqual(better.body.entries, [{ name: "Bo", seconds: 15 }]);
});

test("names are tidied and checked", () => {
  assert.equal(cleanName("  Ada   Lovelace "), "Ada Lovelace");
  assert.equal(cleanName("José_2.0-x"), "José_2.0-x");
  assert.equal(cleanName("मनोज"), "मनोज");
  for (const bad of ["", "   ", "-_-", "<script>", "a".repeat(17), "emoji🙂", 42, null]) {
    assert.equal(cleanName(bad), null, JSON.stringify(bad));
  }
});

test("rejects bad submissions without saving them", async () => {
  const lb = setup();
  const bad = [
    { level: "sandbox", name: "A", seconds: 5 },     // Free Play has no timer
    { level: "nope", name: "A", seconds: 5 },
    { level: "__proto__", name: "A", seconds: 5 },
    { level: "hoop", name: "<b>hi</b>", seconds: 5 },
    { level: "hoop", name: "A", seconds: "5" },
    { level: "hoop", name: "A", seconds: 0.1 },      // faster than physically possible
    { level: "tower", name: "A", seconds: 2.9 },
    { level: "hoop", name: "A", seconds: 99999 },
    { level: "hoop", name: "A" },
    null,
  ];
  for (const body of bad) {
    const res = await lb.post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.body.error);
  }
  assert.equal((await lb.post("not json")).status, 400);
  assert.equal((await lb.get("?level=nope")).status, 400);
  const { body } = await lb.get();
  assert.ok(Object.values(body.boards).every((entries) => entries.length === 0));
});

test("limits how often one IP can submit", async () => {
  const lb = setup();
  let status;
  for (let i = 0; i < 31; i++) {
    ({ status } = await lb.post({ level: "hoop", name: `P${i}`, seconds: 5 + i }, { from: "1.2.3.4" }));
  }
  assert.equal(status, 429);
  assert.equal((await lb.post({ level: "hoop", name: "Other", seconds: 5 }, { from: "5.6.7.8" })).status, 200);
});

test("missing or broken database gives a clear error, not a crash", async (t) => {
  t.mock.method(console, "error", () => {});
  const unset = createHandlers(() => { throw new Error("no env"); });
  assert.equal((await unset.GET(new Request("http://x/api/leaderboard"))).status, 503);

  const broken = createHandlers(() => makeLeaderboard({
    pipeline: async () => { throw new Error("down"); },
    transaction: async () => { throw new Error("down"); },
  }));
  const res = await broken.GET(new Request("http://x/api/leaderboard"));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /unavailable/);
});

test("Upstash client sends commands to the REST API", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return Response.json([{ result: "OK" }, { result: 3 }]);
  });
  const redis = upstash("https://db.upstash.io/", "secret");
  assert.deepEqual(await redis.transaction([["SET", "a", 1], ["INCR", "b"]]), ["OK", 3]);
  assert.equal(calls[0].url, "https://db.upstash.io/multi-exec");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(calls[0].init.body), [["SET", "a", 1], ["INCR", "b"]]);

  t.mock.method(globalThis, "fetch", async () => Response.json([{ error: "WRONGTYPE" }]));
  await assert.rejects(redis.pipeline([["GET", "a"]]), /WRONGTYPE/);
});

test("client knows when a time makes the top 5", () => {
  const board = (...s) => s.map((seconds, i) => ({ name: `P${i}`, seconds }));
  assert.equal(qualifies([], 99), true);
  assert.equal(qualifies(board(1, 2, 3, 4), 99), true);
  assert.equal(qualifies(board(1, 2, 3, 4, 5), 4.9), true);
  assert.equal(qualifies(board(1, 2, 3, 4, 5), 5.1), false);
});
