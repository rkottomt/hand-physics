// Online leaderboard: the top 5 fastest times on each level.
// Used by the Vercel function (api/leaderboard.mjs), the local dev server and the tests.
// (Files in api/_lib/ are not turned into endpoints by Vercel.)
//
// Storage is Redis: one sorted set per level, member = player name, score = their best
// time in seconds. Only the top 5 are kept, so the database never grows.

export const TOP_N = 5;
const MAX_SECONDS = 3600;
const MAX_NAME = 16;
const RATE_LIMIT = 30; // submissions per IP per minute (a class on one Wi-Fi shares an IP)

// The timed levels, with the fastest time that's physically possible on each:
// the goal has to stay met for the level's holdMs after the clock starts.
// Must match js/levels.js (tests/leaderboard.test.mjs checks this).
export const LEVEL_MIN_SECONDS = {
  "first-grab": 0.8,
  tower: 3,
  hoop: 0.6,
  knockdown: 0.4,
  seesaw: 3,
};
export const LEVEL_IDS = Object.keys(LEVEL_MIN_SECONDS);

// Trims and collapses spaces. Returns null unless it's 1-16 letters, numbers, spaces, _ . -
export function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  const ok = new RegExp(`^[\\p{L}\\p{M}\\p{N} _.-]{1,${MAX_NAME}}$`, "u").test(name) && /[\p{L}\p{N}]/u.test(name);
  return ok ? name : null;
}

// Returns { level, name, seconds } or { error }.
export function validateSubmission(body) {
  const { level, name, seconds } = body ?? {};
  if (!Object.hasOwn(LEVEL_MIN_SECONDS, level)) return { error: "Unknown level." };
  const clean = cleanName(name);
  if (!clean) return { error: `Names are 1-${MAX_NAME} letters, numbers, spaces, _ . or -` };
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return { error: "Time must be a number." };
  if (seconds < LEVEL_MIN_SECONDS[level] || seconds > MAX_SECONDS) return { error: "That time isn't possible on this level." };
  return { level, name: clean, seconds: Math.round(seconds * 1000) / 1000 };
}

// [member, score, member, score, ...] from ZRANGE WITHSCORES -> [{ name, seconds }]
function toEntries(flat) {
  const entries = [];
  for (let i = 0; i < flat.length; i += 2) entries.push({ name: flat[i], seconds: Number(flat[i + 1]) });
  return entries;
}

// The leaderboard on top of any client with pipeline(cmds) and transaction(cmds).
export function makeLeaderboard(redis, { prefix = "lb:" } = {}) {
  const key = (level) => `${prefix}${level}`;
  return {
    async top(levels) {
      const results = await redis.pipeline(levels.map((l) => ["ZRANGE", key(l), 0, TOP_N - 1, "WITHSCORES"]));
      return Object.fromEntries(levels.map((l, i) => [l, toEntries(results[i])]));
    },

    // Keeps each player's best time (LT only lowers an existing score), then drops
    // everything below 5th place. Done as one transaction so racing submits can't interleave.
    async submit(level, name, seconds) {
      const [, , flat] = await redis.transaction([
        ["ZADD", key(level), "LT", seconds, name],
        ["ZREMRANGEBYRANK", key(level), TOP_N, -1],
        ["ZRANGE", key(level), 0, TOP_N - 1, "WITHSCORES"],
      ]);
      const entries = toEntries(flat);
      const rank = entries.findIndex((e) => e.name === name) + 1 || null;
      return { entries, rank };
    },

    // Fixed one-minute window per IP.
    async allow(ip) {
      const k = `${prefix}rate:${ip}`;
      const [, count] = await redis.pipeline([["SET", k, 0, "EX", 60, "NX"], ["INCR", k]]);
      return count <= RATE_LIMIT;
    },
  };
}

// Minimal client for Upstash's Redis REST API (no npm dependency needed).
export function upstash(url, token) {
  async function send(path, commands) {
    const res = await fetch(`${url.replace(/\/$/, "")}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(commands),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(out)) throw new Error(`Redis ${res.status}: ${out?.error ?? "bad response"}`);
    return out.map((r) => {
      if (r.error) throw new Error(`Redis: ${r.error}`);
      return r.result;
    });
  }
  return {
    pipeline: (commands) => send("pipeline", commands),
    transaction: (commands) => send("multi-exec", commands),
  };
}

const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

function clientIp(request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

// Web-standard GET/POST handlers. getBoard() is called per request so a missing
// database config becomes a clear 503 instead of a crashed function.
//   GET  /api/leaderboard[?level=id]          -> { boards: { [levelId]: [{ name, seconds }] } }
//   POST /api/leaderboard { level, name, seconds } -> { entries, rank }   (rank is null if not top 5)
export function createHandlers(getBoard) {
  async function withBoard(fn) {
    let board;
    try {
      board = getBoard();
    } catch (err) {
      console.error(err);
      return json({ error: "The leaderboard isn't set up on this server." }, 503);
    }
    try {
      return await fn(board);
    } catch (err) {
      console.error(err);
      return json({ error: "The leaderboard is unavailable right now." }, 502);
    }
  }

  return {
    GET: (request) => withBoard(async (board) => {
      const level = new URL(request.url).searchParams.get("level");
      if (level && !Object.hasOwn(LEVEL_MIN_SECONDS, level)) return json({ error: "Unknown level." }, 400);
      return json({ boards: await board.top(level ? [level] : LEVEL_IDS) });
    }),

    POST: (request) => withBoard(async (board) => {
      const body = await request.json().catch(() => null);
      const entry = validateSubmission(body);
      if (entry.error) return json({ error: entry.error }, 400);
      if (!(await board.allow(clientIp(request)))) {
        return json({ error: "Too many submissions. Try again in a minute." }, 429);
      }
      return json(await board.submit(entry.level, entry.name, entry.seconds));
    }),
  };
}

// Reads the database settings that the Vercel Upstash integration adds as env vars.
export function boardFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Missing KV_REST_API_URL / KV_REST_API_TOKEN");
  return makeLeaderboard(upstash(url, token), { prefix: env.LEADERBOARD_PREFIX ?? "lb:" });
}
