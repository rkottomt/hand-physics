// Local server: serves the game and runs /api/leaderboard the same way Vercel does.
//   npm start   ->  http://localhost:8000
// The leaderboard lives in memory (reset on restart) unless the Upstash env vars are set:
//   npx vercel env pull .env.local && node --env-file=.env.local scripts/dev-server.mjs
// The browser tests (tests/e2e.mjs) also use this server.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHandlers, makeLeaderboard, boardFromEnv } from "../api/_lib/leaderboard.mjs";
import { memoryRedis } from "../api/_lib/memory-redis.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json",
};

export function startServer({ port = 0, board } = {}) {
  board ??= process.env.KV_REST_API_URL ? boardFromEnv() : makeLeaderboard(memoryRedis());
  const api = createHandlers(() => board);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/leaderboard") return handleApi(req, res, url, api);

    const file = path.join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

// Node request -> Web Request -> handler -> Node response
async function handleApi(req, res, url, api) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const handler = api[req.method];
  const response = handler
    ? await handler(new Request(url, {
        method: req.method,
        headers: req.headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      }))
    : new Response(null, { status: 405 });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer({ port: Number(process.env.PORT ?? 8000) });
  const where = process.env.KV_REST_API_URL ? "Upstash Redis" : "memory";
  console.log(`Hand Physics on http://localhost:${server.address().port}/  (leaderboard: ${where})`);
}
