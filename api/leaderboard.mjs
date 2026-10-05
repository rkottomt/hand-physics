// Vercel serverless function: /api/leaderboard (see api/_lib/leaderboard.mjs).
import { createHandlers, boardFromEnv } from "./_lib/leaderboard.mjs";

const handlers = createHandlers(() => boardFromEnv());

export function GET(request) { return handlers.GET(request); }
export function POST(request) { return handlers.POST(request); }
