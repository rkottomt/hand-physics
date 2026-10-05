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
import { fetchBoards, submitTime, qualifies } from "./leaderboard.js";

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
    setHandStatus(camState === "on" ? "Looking for your hand…" : "");
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
  setHandStatus(grabSource === "hand" ? "Holding" : frame.pinching ? "Pinching" : "Hand found: pinch to grab");
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
    await tracker.start((msg) => { camBtn.textContent = "Starting…"; setHandStatus(msg); });
    camState = "on";
    video.classList.add("live");
    camBtn.classList.add("on");
    camBtn.textContent = "Hand on";
    setHandStatus("Looking for your hand…");
    toast("Hand tracking is on. Hold your hand up to the camera!");
  } catch (err) {
    console.warn("Camera/hand tracking failed:", err);
    tracker.stop();
    camState = "off";
    camBtn.textContent = "Use hand";
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
  camBtn.textContent = "Use hand";
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
  $("levelNum").textContent = levelNumber(index);
  $("levelName").textContent = level.name;
  $("levelGoal").textContent = level.goal;
  $("levelTip").textContent = level.tip;
  $("spawnBar").hidden = !level.sandbox;
  timerEl.hidden = !!level.sandbox;
  try { history.replaceState(null, "", `#${level.id}`); } catch { /* sandboxed iframe */ }
}

// The HUD reads from the game every frame instead of being pushed updates.
(function hudLoop() {
  timerEl.textContent = `${game.elapsed().toFixed(1)}s`;
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
  $("winNext").textContent = next ? "Next level" : "Back to levels";
  $("winNext").onclick = () => { closeOverlay("winModal"); next ? loadLevel(index + 1) : openMenu(); };
  showWinBoard(level, seconds);
  // Short delay so you get to see the moment you won
  setTimeout(() => openOverlay("winModal", "winNext"), 700);
}

const STAR_PATH = "M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z";
function starHTML(stars) {
  return [1, 2, 3].map((i) =>
    `<svg class="star${i <= stars ? " on" : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`).join("");
}

const levelNumber = (index) => String(index + 1).padStart(2, "0");

// ---------- leaderboard ----------
const nameForm = $("nameForm");
const nameInput = $("nameInput");
const boardMsg = $("boardMsg");
let currentRun = null;  // the win the win screen is showing: { level, seconds }
let pendingRun = null;  // that win, while it's a top-5 time waiting for a name

function renderBoard(list, entries, me) {
  const rows = entries.map((entry, i) => {
    const li = document.createElement("li");
    li.classList.toggle("me", entry.name === me);
    li.innerHTML = `<span class="rank"></span><span class="who"></span><span class="time"></span>`;
    li.children[0].textContent = i + 1;
    li.children[1].textContent = entry.name;
    li.children[2].textContent = `${entry.seconds.toFixed(2)}s`;
    return li;
  });
  if (!rows.length) {
    rows.push(Object.assign(document.createElement("li"), { className: "empty", textContent: "No times yet. Be the first!" }));
  }
  list.replaceChildren(...rows);
}

function showWinBoard(level, seconds) {
  const run = { level, seconds };
  currentRun = run;
  pendingRun = null;
  nameForm.hidden = true;
  $("winBoardList").replaceChildren();
  boardMsg.textContent = "Loading leaderboard…";
  fetchBoards(level.id).then((boards) => {
    if (currentRun !== run) return;
    const entries = boards[level.id];
    renderBoard($("winBoardList"), entries, settings.playerName);
    if (qualifies(entries, seconds)) {
      pendingRun = run;
      nameInput.value = settings.playerName;
      nameForm.hidden = false;
      const place = entries.filter((e) => e.seconds <= seconds).length + 1;
      boardMsg.textContent = `That's a top-5 time! Enter your name to claim #${place}.`;
    } else {
      boardMsg.textContent = `Beat ${entries.at(-1).seconds.toFixed(2)}s to make the top 5.`;
    }
  }).catch((err) => {
    if (currentRun === run) boardMsg.textContent = `${err.message} Your time is still saved on this device.`;
  });
}

nameForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const run = pendingRun;
  const name = nameInput.value.trim().replace(/\s+/g, " ");
  if (!run) return;
  if (!name) { nameInput.focus(); return; }
  $("nameSubmit").disabled = true;
  boardMsg.textContent = "Saving…";
  try {
    const { entries, rank } = await submitTime(run.level.id, name, run.seconds);
    settings.playerName = name;
    saveSettings(settings);
    if (currentRun !== run) return;
    pendingRun = null;
    nameForm.hidden = true;
    renderBoard($("winBoardList"), entries, name);
    const mine = entries[rank - 1];
    boardMsg.textContent = !rank ? "Someone just beat that time, so it didn't make the top 5."
      : mine.seconds < Math.round(run.seconds * 1000) / 1000 ? `Your best of ${mine.seconds.toFixed(2)}s is still #${rank}.`
      : `You're #${rank} on ${run.level.name}.`;
  } catch (err) {
    if (currentRun === run) boardMsg.textContent = err.message;
  } finally {
    $("nameSubmit").disabled = false;
  }
});

// The leaderboards overlay: one tab per timed level
const TIMED = LEVELS.filter((l) => !l.sandbox);
const boardTabs = $("boardTabs");
let boardsCache = null;   // { levelId: entries } from the last fetch
let boardsTab = TIMED[0].id;

for (const level of TIMED) {
  const index = LEVELS.indexOf(level);
  const tab = document.createElement("button");
  tab.className = "tab";
  tab.setAttribute("role", "tab");
  tab.dataset.level = level.id;
  tab.innerHTML = `<span class="tab-num">${levelNumber(index)}</span><span class="tab-name">${level.name}</span>`;
  tab.addEventListener("click", () => { boardsTab = level.id; renderBoardsTab(); });
  boardTabs.append(tab);
}

function renderBoardsTab() {
  for (const tab of boardTabs.children) tab.setAttribute("aria-selected", tab.dataset.level === boardsTab);
  const entries = boardsCache?.[boardsTab];
  if (entries) renderBoard($("boardsList"), entries, settings.playerName);
  else $("boardsList").replaceChildren();
}

function openBoards() {
  if (game.level && !game.level.sandbox) boardsTab = game.level.id;
  renderBoardsTab();
  $("boardsMsg").textContent = boardsCache ? "" : "Loading…";
  openOverlay("boards", "boardsClose");
  fetchBoards().then((boards) => {
    boardsCache = boards;
    $("boardsMsg").textContent = "";
    renderBoardsTab();
  }).catch((err) => { $("boardsMsg").textContent = err.message; });
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
      <span class="lc-num">${levelNumber(i)}</span>
      <span class="lc-name">${level.name}</span>
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
$("boardsBtn").addEventListener("click", openBoards);
$("menuBoardsBtn").addEventListener("click", openBoards);
$("boardsClose").addEventListener("click", () => closeOverlay("boards"));
$("restartBtn").addEventListener("click", () => { grabSource = null; game.restart(); });
$("winReplay").addEventListener("click", () => { closeOverlay("winModal"); grabSource = null; game.restart(); });
$("winMenu").addEventListener("click", openMenu);
$("clearBtn").addEventListener("click", () => { grabSource = null; game.clearShapes(); });
document.querySelectorAll("[data-spawn]").forEach((btn) =>
  btn.addEventListener("click", () => game.spawn(btn.dataset.spawn)));

const muteBtn = $("muteBtn");
function applyMute() {
  setMuted(settings.muted);
  muteBtn.setAttribute("aria-pressed", settings.muted);
  muteBtn.title = settings.muted ? "Sound is off (M)" : "Sound is on (M)";
}
muteBtn.addEventListener("click", () => {
  unlockAudio();
  settings.muted = !settings.muted;
  saveSettings(settings);
  applyMute();
});
applyMute();

// Click on the dark backdrop closes help and leaderboards (not the menu or win screen, which need a choice)
for (const id of ["help", "boards"]) {
  $(id).addEventListener("click", (e) => { if (e.target.id === id) closeOverlay(id); });
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (e.target instanceof HTMLInputElement && key !== "escape") return; // typing a name
  if (key === "escape") {
    if (isOpen("help")) closeOverlay("help");
    else if (isOpen("boards")) closeOverlay("boards");
    else if (isOpen("menu")) { if (game.level) closeOverlay("menu"); }
    else openMenu();
  } else if (isOpen("menu") || isOpen("help") || isOpen("boards")) {
    return;
  } else if (key === "r") {
    closeOverlay("winModal");
    grabSource = null;
    game.restart();
  } else if (key === "m") {
    muteBtn.click();
  } else if (key === "h") {
    openOverlay("help", "helpClose");
  } else if (key === "l") {
    openBoards();
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

// Editing the #level-id in the address bar (or back/forward) switches level.
window.addEventListener("hashchange", () => {
  const i = LEVELS.findIndex((l) => `#${l.id}` === location.hash);
  if (i >= 0 && i !== game.levelIndex) {
    ["menu", "winModal"].forEach(closeOverlay);
    loadLevel(i);
  }
});

// Exposed for the browser tests in tests/e2e.mjs (and handy in the dev console).
window.game = game;
