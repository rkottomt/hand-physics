// Client for the online leaderboard (api/leaderboard.mjs). Every call can fail
// (offline, or a static server without the API) and the game keeps working.
const API = "api/leaderboard";
export const TOP_N = 5;

async function request(url, options) {
  let res, data;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
    data = await res.json();
  } catch {
    throw new Error("Couldn't reach the leaderboard.");
  }
  if (!res.ok) throw new Error(data.error ?? "The leaderboard is unavailable right now.");
  return data;
}

// { levelId: [{ name, seconds }, ...] } for every timed level, or just one.
export async function fetchBoards(levelId) {
  const query = levelId ? `?level=${encodeURIComponent(levelId)}` : "";
  return (await request(API + query)).boards;
}

// -> { entries, rank }   rank is 1-5, or null if the time didn't make the top 5
export function submitTime(levelId, name, seconds) {
  return request(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: levelId, name, seconds }),
  });
}

export function qualifies(entries, seconds) {
  return entries.length < TOP_N || seconds < entries[entries.length - 1].seconds;
}
