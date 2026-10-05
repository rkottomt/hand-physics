# Prompt Log — Hand Physics (15-113 Project 2)

## Tools used
- Claude Code (Claude Opus 5.5): brainstorming, scaffolding, code generation.
- (Fill in: which tool for which job, and why.)

## Session 1 — 2026-10-01: Idea + MVP scaffold
**Prompt (verbatim):**
> brainstorm ideas, let me choose one and then start building

Chose from options: wanted "webcam hand tracking, but not with music" → picked "Hand-controlled physics toy".

**Result:** Claude generated the MVP: MediaPipe Hand Landmarker (pinch detection with hysteresis) + Matter.js world,
pinch-to-grab via a Constraint, mouse fallback, and a "stack above the line for 3s" goal.
Files: index.html, style.css, js/hand.js, js/physics.js, js/main.js.

**What I changed myself:** (fill in)

## One place AI got it wrong
(fill in as it happens)

## Session 2: 2026-10-01: More levels, testing, deployment
**Prompt (verbatim):**
> Test everything. make it more complex and very user friendly, push code regularly to git repo but do not add urself as a contributor. once you are convinced that it is deployment ready, deploy onto vercel and give me the vercel link. take your time

**What Claude did:**
- Split the code into DOM-free game logic (`game.js`, `levels.js`, `gesture.js`) and browser UI (`main.js`, `overlay.js`, `hand.js`, `audio.js`, `progress.js`) so levels could be tested headlessly in Node.
- Added 6 levels (First Grab, Sky Tower, Hoop Shot, Knockdown, Balancing Act, Free Play), a level menu, how-to-play help, a win screen with stars, saved progress, sound, a hand skeleton overlay, and mouse/touch fallback.
- Wrote 30 Node tests and a Playwright browser suite. The browser suite feeds a real hand photo to Chrome as a fake webcam to test MediaPipe end to end.
- Removed Claude's co-author line from commits as requested.

**Bugs the tests caught (fixed):**
- Knockdown: the third shelf touched the right wall, so a hit target got pinned against the wall and the level could never be won.
- Balancing Act: blocks sit above the pivot, which makes the seesaw an inverted pendulum, so even a perfectly balanced load tipped over. Added a restoring spring and tuned it with a parameter sweep so balanced loads win and lopsided loads fail.
- Hand-status pill and toasts covered the play area (found from test screenshots).

## One place AI got it wrong
Claude's first fix for the seesaw added torque scaled by the plank's inertia (`plank.torque -= plank.inertia * (...)`). Claude expected this to work, but Matter.js multiplies torque by the time step squared, so the simulation blew up to angles around 10^200 degrees and then NaN. The parameter-sweep test exposed it immediately. The fix was to adjust the plank's angular velocity directly each step (a velocity-level spring), then tune the strength in simulation.
_(Add your own examples too.)_

## Which tool for which job
_(Fill in.)_

## What I changed myself
_(Fill in. Easy, explainable changes: PINCH_ON/PINCH_OFF in js/gesture.js, a level's layout or par time in js/levels.js, colors in style.css.)_

## Session 3: 2026-10-05: Online leaderboard
**Prompt (verbatim):**
> connect this to a backend such that we can keep leaderboard for whoever does itf astest. just the top 5 fastest for each level. ppl will have to input their username

**What Claude did:**
- Added a Vercel serverless function (`api/leaderboard.mjs`) backed by Upstash Redis from the Vercel Marketplace. Each level is a Redis sorted set that keeps only the top 5, with one entry per name.
- Win screen: shows the level's top 5. A top-5 time gets a name box (the last name is remembered). Added a 🏆 leaderboard overlay with a tab per level.
- Server-side checks: level, name format, impossible times, and a per-IP rate limit.
- Added a local dev server that runs the API with an in-memory database, 10 API unit tests, and browser tests for submitting and for the leaderboard being offline.

**Problem Claude spotted while building it:**
- The game's keyboard shortcuts (R restart, H help, M mute) would have fired while typing a name like "Rohit" on the win screen. Shortcuts are now ignored while typing in a text box, and a browser test types a name containing R, H and M to check this.
