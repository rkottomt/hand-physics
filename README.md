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
No build step. The page is plain HTML/CSS/JS modules, so it only needs a static file server:

```bash
npx serve -l 8000 .      # or: python3 -m http.server 8000
# open http://localhost:8000
```

The camera only works on `localhost` or HTTPS (a browser security rule).

## Secrets
There are none. The app has no backend and no API keys. Matter.js and MediaPipe load from public CDNs, and the webcam video is processed entirely in the browser and never uploaded. Saved progress lives in the browser's `localStorage`.

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
| `index.html`, `style.css` | Layout: top bar, stage (video behind a canvas), level menu, help and win overlays. Responsive down to phone width. |
| `js/main.js` | UI controller. Turns mouse/touch and hand frames into grab/move/release calls, runs the HUD, menus, keyboard shortcuts and win screen. |
| `js/game.js` | DOM-free game logic around a Matter.js engine: loads levels, grabbing via a spring `Constraint`, throw-speed cap, out-of-reach release, respawning lost or stranded bodies, hold-to-win timing, stars. |
| `js/levels.js` | The six levels as data: `build()` creates bodies, `check()` says whether the goal is met, optional `tick()`/`draw()` hooks (e.g. the seesaw's restoring spring). |
| `js/hand.js` | Webcam + MediaPipe Hand Landmarker (loaded on demand, GPU with CPU fallback). Emits a smoothed, mirrored cursor and pinch state per video frame. |
| `js/gesture.js` | Pure math: pinch ratio (thumb–index gap ÷ hand size), pinch hysteresis (on < 0.35, off > 0.5), smoothing, and mapping video coords to the canvas to match `object-fit: cover`. |
| `js/overlay.js` | Canvas drawing on top of the physics: zones, goal line, no-reach area, hold progress bar, hover/held outlines, hand skeleton and cursor ring. |
| `js/audio.js` | Synthesized sound effects with the Web Audio API. |
| `js/progress.js` | Best stars/time and settings in `localStorage` (failure-safe). |

### Interaction design
- **Grab:** pinch over a shape, or within 30 px of one. A pinch that starts just before reaching a shape still grabs it for 300 ms.
- **Release / throw:** open your hand. The body keeps its velocity, capped at 32 px/step so it can't tunnel through walls.
- **Out-of-reach zones** (Hoop Shot, Knockdown): moving a held body past the red line lets go of it, which is how you throw. Bodies left resting out of reach roll back to you after 1.5 s.
- **Tracking dropouts** under 250 ms don't drop what you're holding.
- The **timer starts on your first grab**, not when the level loads.

### Testing
```bash
npm install
npm test            # 30 headless tests: every level in Node with real Matter.js physics
npm run test:e2e    # Playwright in Chromium: UI flows, touch on a phone viewport, camera-denied
                    # handling, and real MediaPipe tracking using a hand photo as a fake webcam
BASE_URL=https://<deployed-url>/ npm run test:e2e   # same checks against the live site
```
The headless tests check that every level is beatable, can't be won by doing nothing, and restarts cleanly. Simulated solutions confirm the intended solution works and wrong ones fail (for example, a lopsided seesaw doesn't count).
