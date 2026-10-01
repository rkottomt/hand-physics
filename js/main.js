// UI controller: connects input (mouse/touch + hand tracking) to the Game,
// draws it with Matter.Render, and runs the menus, HUD and win screen.
import { Game } from "./game.js";
import { LEVELS } from "./levels.js";
import { WIDTH, HEIGHT } from "./constants.js";
import { HandTracker } from "./hand.js";
import { coverMap } from "./gesture.js";
import { drawOverlay } from "./overlay.js";
import { sfx, setMuted, unlockAudio } from "./audio.js";
import { loadProgress, saveResult, loadSettings, saveSettings } from "./progress.js";

const $ = (id) => document.getElementById(id);
const canvas = $("world");
const video = $("video");

const progress = loadProgress();
const settings = loadSettings();
setMuted(settings.muted);

// ---------- physics + rendering ----------
const game = new Game();
const render = Matter.Render.create({
  canvas,
  engine: game.engine,
  options: {
    width: WIDTH,
    height: HEIGHT,
    wireframes: false,
    background: "transparent",
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  },
});
Matter.Render.run(render);
const runner = Matter.Runner.create();
Matter.Runner.run(runner, game.engine);

// Pause physics while the tab is hidden so nothing explodes from a huge time jump.
document.addEventListener("visibilitychange", () => { runner.enabled = !document.hidden; });

// State the overlay needs each frame
const view = { hand: null, hovered: null, deniedFlash: 0 };
let mouse = null;          // last mouse/touch position in canvas pixels
let grabSource = null;     // "mouse" | "hand" | null: who is holding the current body

Matter.Events.on(render, "afterRender", () => {
  const cursor = view.hand ?? mouse;
  view.hovered = cursor && !game.heldBody() && game.canReach(cursor.x) ? game.bodyAt(cursor.x, cursor.y) : null;
  if (view.deniedFlash > 0) view.deniedFlash--;
  drawOverlay(render.context, game, view);
  updateCursor(cursor);
});

// ---------- game events ----------
game.on("grab", () => sfx.grab());
game.on("release", () => sfx.release());
game.on("respawn", () => sfx.respawn());
game.on("outOfReach", () => { grabSource = null; view.deniedFlash = 20; });
game.on("win", onWin);

Matter.Events.on(game.engine, "collisionStart", (e) => {
  for (const { bodyA, bodyB } of e.pairs) {
    const impact = Matter.Vector.magnitude(Matter.Vector.sub(bodyA.velocity, bodyB.velocity));
    if (impact > 4) { sfx.hit(impact); break; }
  }
});

// ---------- shared grab logic for both input types ----------
function tryGrab(x, y, source) {
  if (game.heldBody() || game.won) return false;
  if (!game.canReach(x)) {
    view.deniedFlash = 20;
    sfx.denied();
    return false;
  }
  if (game.grabAt(x, y)) {
    grabSource = source;
    return true;
  }
  return false;
}

function releaseFrom(source) {
  if (grabSource === source) {
    game.release();
    grabSource = null;
  }
}

// ---------- mouse / touch ----------
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * WIDTH, y: ((e.clientY - r.top) / r.height) * HEIGHT };
}

canvas.addEventListener("pointerdown", (e) => {
  unlockAudio();
  canvas.setPointerCapture(e.pointerId);
  mouse = toCanvas(e);
  tryGrab(mouse.x, mouse.y, "mouse");
});
canvas.addEventListener("pointermove", (e) => {
  mouse = toCanvas(e);
  if (grabSource === "mouse") game.moveGrab(mouse.x, mouse.y);
});
const endPointer = () => releaseFrom("mouse");
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && grabSource !== "mouse") mouse = null; });

function updateCursor(cursor) {
  canvas.classList.toggle("holding", !!game.heldBody());
  canvas.classList.toggle("pointing", !game.heldBody() && !!view.hovered);
  canvas.classList.toggle("denied", !!cursor && !game.heldBody() && !game.canReach(cursor.x));
}

// ---------- hand tracking ----------
const tracker = new HandTracker(video, onHandFrame);
const camBtn = $("camBtn");
const handStatus = $("handStatus");
let camState = "off";        // off | starting | on
let wasPinching = false;
let pinchStartedAt = 0;
let handLostAt = null;

function onHandFrame(frame) {
  const now = performance.now();
  if (!frame) {
    // Brief tracking dropouts are common; only let go after a short grace period.
    handLostAt ??= now;
    if (now - handLostAt > 250) {
      view.hand = null;
      wasPinching = false;
      releaseFrom("hand");
    }
    setHandStatus(camState === "on" ? "🔍 Looking for your hand…" : "");
    return;
  }
  handLostAt = null;

  const { w, h } = tracker.videoSize;
  const map = (p) => coverMap(p.x, p.y, w, h, WIDTH, HEIGHT);
  const p = map(frame);
  view.hand = { ...p, pinching: frame.pinching, ratio: frame.ratio, points: frame.points.map(map) };

  if (frame.pinching) {
    if (!wasPinching) {
      pinchStartedAt = now;
      tryGrab(p.x, p.y, "hand");
    } else if (grabSource === "hand") {
      game.moveGrab(p.x, p.y);
    } else if (!game.heldBody() && now - pinchStartedAt < 300 && game.canReach(p.x)) {
      // Forgiving: pinching just before reaching a shape still picks it up.
      tryGrab(p.x, p.y, "hand");
    }
  } else if (wasPinching) {
    releaseFrom("hand");
  }
  wasPinching = frame.pinching;
  setHandStatus(grabSource === "hand" ? "🤏 Holding" : frame.pinching ? "🤏 Pinching" : "✋ Hand found: pinch to grab");
}

function setHandStatus(text) {
  handStatus.hidden = !text;
  handStatus.textContent = text;
}

async function startCamera() {
  if (camState !== "off") return;
  camState = "starting";
  camBtn.disabled = true;
  try {
    await tracker.start((msg) => { camBtn.textContent = "⏳ Starting…"; setHandStatus(msg); });
    camState = "on";
    video.classList.add("live");
    camBtn.classList.add("on");
    camBtn.textContent = "📷 Hand on";
    setHandStatus("🔍 Looking for your hand…");
    toast("Hand tracking is on. Hold your hand up to the camera!");
  } catch (err) {
    console.warn("Camera/hand tracking failed:", err);
    tracker.stop();
    camState = "off";
    camBtn.textContent = "📷 Use hand";
    setHandStatus("");
    toast(cameraErrorMessage(err), 6000);
  } finally {
    camBtn.disabled = false;
  }
}

function stopCamera() {
  tracker.stop();
  releaseFrom("hand");
  view.hand = null;
  camState = "off";
  video.classList.remove("live");
  camBtn.classList.remove("on");
  camBtn.textContent = "📷 Use hand";
  setHandStatus("");
}

function cameraErrorMessage(err) {
  const fallback = "You can still play with your mouse or finger.";
  switch (err?.name) {
    case "NotAllowedError": return `Camera permission was blocked. Allow it in your browser's address bar to use your hand. ${fallback}`;
    case "NotFoundError":
    case "OverconstrainedError": return `No camera was found. ${fallback}`;
    case "NotReadableError": return `Your camera is busy in another app. Close it and try again. ${fallback}`;
    case "InsecureContext": return `The camera only works over HTTPS. ${fallback}`;
    default: return `Hand tracking couldn't load (check your connection). ${fallback}`;
  }
}

camBtn.addEventListener("click", () => {
  unlockAudio();
  camState === "on" ? stopCamera() : startCamera();
});

// ---------- levels + HUD ----------
const levelStatus = $("levelStatus");
const timerEl = $("timer");

function loadLevel(index) {
  grabSource = null;
  game.load(index);
  const level = LEVELS[index];
  $("levelName").textContent = `${level.icon} ${index + 1}. ${level.name}`;
  $("levelGoal").textContent = level.goal;
  $("levelTip").textContent = level.tip;
  $("spawnBar").hidden = !level.sandbox;
  timerEl.hidden = !!level.sandbox;
  try { history.replaceState(null, "", `#${level.id}`); } catch { /* sandboxed iframe */ }
}

// The HUD reads from the game every frame instead of being pushed updates.
(function hudLoop() {
  timerEl.textContent = `⏱ ${game.elapsed().toFixed(1)}s`;
  const holding = game.holdProgress > 0 && !game.won;
  levelStatus.textContent = holding ? "Hold steady…" : game.status;
  requestAnimationFrame(hudLoop);
})();

// ---------- win ----------
function onWin({ index, seconds, stars, level }) {
  sfx.win();
  const isBest = saveResult(progress, level.id, stars, seconds);
  const best = progress[level.id];
  $("winTitle").textContent = ["Nice!", "Great job!", "Perfect!"][stars - 1];
  $("winStars").innerHTML = starHTML(stars);
  $("winTime").textContent = `${seconds.toFixed(1)}s`;
  $("winBest").textContent = isBest
    ? `New best! ${stars < 3 ? `Beat ${level.par}s for 3 stars.` : ""}`
    : `Best: ${best.seconds.toFixed(1)}s · 3 stars under ${level.par}s`;
  const next = index + 1 < LEVELS.length;
  $("winNext").textContent = next ? "Next level →" : "All levels done 🎉";
  $("winNext").onclick = () => { closeOverlay("winModal"); next ? loadLevel(index + 1) : openMenu(); };
  // Short delay so you get to see the moment you won
  setTimeout(() => openOverlay("winModal", "winNext"), 700);
}

function starHTML(stars) {
  return [1, 2, 3].map((i) => `<span class="star${i <= stars ? " on" : ""}">★</span>`).join("");
}

// ---------- overlays ----------
function openOverlay(id, focusId) {
  $(id).hidden = false;
  if (focusId) $(focusId).focus();
}
function closeOverlay(id) { $(id).hidden = true; }
const isOpen = (id) => !$(id).hidden;

function openMenu() {
  buildLevelGrid();
  closeOverlay("winModal");
  openOverlay("menu");
}

function buildLevelGrid() {
  const grid = $("levelGrid");
  grid.innerHTML = "";
  LEVELS.forEach((level, i) => {
    const best = progress[level.id];
    const btn = document.createElement("button");
    btn.className = "level-card";
    btn.innerHTML = `
      <span class="lc-icon">${level.icon}</span>
      <span class="lc-name">${i + 1}. ${level.name}</span>
      <span class="lc-goal">${level.goal}</span>
      <span class="lc-stars">${level.sandbox ? "Sandbox" : starHTML(best?.stars ?? 0) + (best ? ` <small>${best.seconds.toFixed(1)}s</small>` : "")}</span>`;
    btn.addEventListener("click", () => play(i));
    grid.append(btn);
  });
}

function firstUnfinished() {
  const i = LEVELS.findIndex((l) => !l.sandbox && !progress[l.id]);
  return i === -1 ? 0 : i;
}

function play(index) {
  unlockAudio();
  closeOverlay("menu");
  loadLevel(index);
  if (!settings.seenHelp) {
    openOverlay("help", "helpClose");
    settings.seenHelp = true;
    saveSettings(settings);
  }
}

$("menuCamBtn").addEventListener("click", () => { play(game.levelIndex ?? firstUnfinished()); startCamera(); });
$("menuMouseBtn").addEventListener("click", () => play(game.levelIndex ?? firstUnfinished()));
$("menuBtn").addEventListener("click", openMenu);
$("helpBtn").addEventListener("click", () => openOverlay("help", "helpClose"));
$("helpClose").addEventListener("click", () => closeOverlay("help"));
$("restartBtn").addEventListener("click", () => { grabSource = null; game.restart(); });
$("winReplay").addEventListener("click", () => { closeOverlay("winModal"); grabSource = null; game.restart(); });
$("winMenu").addEventListener("click", openMenu);
$("clearBtn").addEventListener("click", () => { grabSource = null; game.clearShapes(); });
document.querySelectorAll("[data-spawn]").forEach((btn) =>
  btn.addEventListener("click", () => game.spawn(btn.dataset.spawn)));

const muteBtn = $("muteBtn");
function applyMute() {
  setMuted(settings.muted);
  muteBtn.textContent = settings.muted ? "🔇" : "🔊";
}
muteBtn.addEventListener("click", () => {
  unlockAudio();
  settings.muted = !settings.muted;
  saveSettings(settings);
  applyMute();
});
applyMute();

// Click on the dark backdrop closes help (not the menu or win screen, which need a choice)
$("help").addEventListener("click", (e) => { if (e.target.id === "help") closeOverlay("help"); });

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === "escape") {
    if (isOpen("help")) closeOverlay("help");
    else if (isOpen("menu")) { if (game.level) closeOverlay("menu"); }
    else openMenu();
  } else if (isOpen("menu") || isOpen("help")) {
    return;
  } else if (key === "r") {
    closeOverlay("winModal");
    grabSource = null;
    game.restart();
  } else if (key === "m") {
    muteBtn.click();
  } else if (key === "h") {
    openOverlay("help", "helpClose");
  }
});

// ---------- toast ----------
let toastTimer;
function toast(text, ms = 3500) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// ---------- start ----------
// Load a level behind the menu so the world is alive; a #level-id link jumps straight in.
const fromHash = LEVELS.findIndex((l) => `#${l.id}` === location.hash);
if (fromHash >= 0) play(fromHash);
else { loadLevel(firstUnfinished()); buildLevelGrid(); }
