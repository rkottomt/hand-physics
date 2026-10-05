# Hand Physics ✋

**Live:** https://hand-physics.vercel.app · **Demo video:** _(link)_

<!--
  TODO (write these sections yourself, in your own words — required by the assignment):
  - What the project does
  - How to use it
  - Features I'm most proud of
  - How AI was used (summary + citations)
-->

## What it does
_TODO: your own words._

## How to use it
_TODO: your own words._

## Features I'm most proud of
_TODO: your own words._

## Running it locally
No build step. The page is plain HTML/CSS/JS modules plus one serverless function for the leaderboard:

```bash
npm start                # http://localhost:8000, with an in-memory leaderboard
```

To use the real leaderboard database locally: `npx vercel env pull .env.local`, then
`node --env-file=.env.local scripts/dev-server.mjs`. Any plain static server (`npx serve`, `python3 -m http.server`) also runs the game. The leaderboard then just shows as offline.

The camera only works on `localhost` or HTTPS (a browser security rule).

## Secrets
The only secrets are the leaderboard database's URL and token (`KV_REST_API_URL`, `KV_REST_API_TOKEN`). The Upstash integration stores them as Vercel environment variables, and only the serverless function reads them, so they never reach the browser or this repo (`.env*.local` is gitignored). Matter.js and MediaPipe load from public CDNs. The webcam video is processed entirely in the browser and never uploaded. Saved progress lives in the browser's `localStorage`.

## Device support
Works on desktop and phones. Hand tracking needs a webcam (front camera on phones). Without one, you can play every level with a mouse or by dragging with a finger.

## How I used AI
_TODO: your own words. Brief summary + citations (e.g. Claude Code / Claude Opus 5.5 generated much of the initial code; MediaPipe Hand Landmarker and Matter.js libraries; the test hand photo is a MediaPipe sample image, Apache-2.0). Full details are in [prompt_log.md](prompt_log.md)._

---

## AI-generated technical documentation
_The section below was written by Claude (Claude Code), not by me._

### Architecture
| File | Responsibility |
|---|---|
| `index.html`, `style.css` | Layout: top bar, stage (video behind a canvas), level menu, help, win and leaderboard overlays. Paper-and-ink theme (Young Serif, IBM Plex Sans/Mono). Responsive down to phone width. |
| `js/constants.js` | Canvas size and the canvas color palette (kept in sync with `style.css`). |
| `js/main.js` | UI controller. Turns mouse/touch and hand frames into grab/move/release calls, runs the HUD, menus, keyboard shortcuts and win screen. |
| `js/game.js` | DOM-free game logic around a Matter.js engine: loads levels, grabbing via a spring `Constraint`, throw-speed cap, out-of-reach release, respawning lost or stranded bodies, hold-to-win timing, stars. |
| `js/levels.js` | The six levels as data: `build()` creates bodies, `check()` says whether the goal is met, optional `tick()`/`draw()` hooks (e.g. the seesaw's restoring spring). |
| `js/hand.js` | Webcam + MediaPipe Hand Landmarker (loaded on demand, GPU with CPU fallback). Emits a smoothed, mirrored cursor and pinch state per video frame. |
| `js/gesture.js` | Pure math: pinch ratio (thumb–index gap ÷ hand size), pinch hysteresis (on < 0.35, off > 0.5), smoothing, and mapping video coords to the canvas to match `object-fit: cover`. |
| `js/overlay.js` | Canvas drawing on top of the physics: zones, goal line, no-reach area, hold progress bar, hover/held outlines, hand skeleton and cursor ring. |
| `js/audio.js` | Synthesized sound effects with the Web Audio API. |
| `js/progress.js` | Best stars/time, settings and the last leaderboard name in `localStorage` (failure-safe). |
| `js/leaderboard.js` | Browser client for the leaderboard API, with an 8 s timeout. If it fails, the game still works and the UI says the board is offline. |
| `api/leaderboard.mjs` | Vercel serverless function at `/api/leaderboard`. |
| `api/_lib/leaderboard.mjs` | Leaderboard logic: validation, rate limiting, Redis commands, and a tiny Upstash REST client (no npm dependencies). |
| `api/_lib/memory-redis.mjs` | In-memory stand-in for the Redis commands used, for local dev and tests. |
| `scripts/dev-server.mjs` | Local server: static files plus the API, as Vercel runs it. |

### Interaction design
- **Grab:** pinch over a shape, or within 30 px of one. A pinch that starts just before reaching a shape still grabs it for 300 ms.
- **Release / throw:** open your hand. The body keeps its velocity, capped at 32 px/step so it can't tunnel through walls.
- **Out-of-reach zones** (Hoop Shot, Knockdown): moving a held body past the red line lets go of it, which is how you throw. Bodies left resting out of reach roll back to you after 1.5 s.
- **Tracking dropouts** under 250 ms don't drop what you're holding.
- The **timer starts on your first grab**, not when the level loads.

### Leaderboard
- **Storage:** Upstash Redis (through the Vercel Marketplace). Each level is a sorted set: member = name, score = best time. After every submit, everything below 5th place is deleted, so the database stays tiny. One player keeps one entry, and a slower run never replaces their best (`ZADD LT`).
- **API:** `GET /api/leaderboard` returns every level's top 5 (`?level=hoop` for one level). `POST /api/leaderboard` with `{ level, name, seconds }` returns the updated top 5 and your rank.
- **Flow:** the win screen loads that level's top 5. If your time makes it, a name box appears, prefilled with the last name you used. The Scores button (or <kbd>L</kbd>) shows all five boards.
- **Checks on the server:** known timed level only (Free Play has no timer), names 1-16 letters/numbers/spaces/`_ . -`, times between the level's physical minimum (its hold time) and 1 hour, and at most 30 submissions per IP per minute.
- **Limitation:** the time is measured in the browser, so a determined cheater could send a fake (but possible) time. Stopping that would need the server to replay and verify each run.

### Testing
```bash
npm install
npm test            # 40 headless tests: every level in Node with real Matter.js physics,
                    # plus the leaderboard API (ordering, top-5 cut, validation, rate limit)
npm run test:e2e    # Playwright in Chromium: UI flows, touch on a phone viewport, camera-denied
                    # handling, leaderboard submit + offline handling, and real MediaPipe
                    # tracking using a hand photo as a fake webcam
BASE_URL=https://<deployed-url>/ npm run test:e2e   # same checks against the live site
```
The headless tests check that every level is beatable, can't be won by doing nothing, and restarts cleanly. Simulated solutions confirm the intended solution works and wrong ones fail (for example, a lopsided seesaw doesn't count).
