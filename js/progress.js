// Best results and settings, saved in this browser's localStorage.
// Wrapped in try/catch because storage can be blocked (private mode, strict settings).
import { pickBetterResult } from "./logic.js";

const PROGRESS_KEY = "hand-physics-progress-v1";
const SETTINGS_KEY = "hand-physics-settings-v1";

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? {}; } catch { return {}; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not saved, still playable */ }
}

export function loadProgress() { return read(PROGRESS_KEY); }

// Keeps the better result: more stars wins, then the faster time.
export function saveResult(progress, levelId, stars, seconds) {
  const prev = progress[levelId];
  const kept = pickBetterResult(prev, { stars, seconds });
  const isBest = kept !== prev;
  if (isBest) {
    progress[levelId] = kept;
    write(PROGRESS_KEY, progress);
  }
  return isBest;
}

export function loadSettings() { return { muted: false, seenHelp: false, playerName: "", ...read(SETTINGS_KEY) }; }
export function saveSettings(settings) { write(SETTINGS_KEY, settings); }
