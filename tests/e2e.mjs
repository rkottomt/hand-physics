// End-to-end browser tests with Playwright (real Chromium, real MediaPipe model).
//   npm run test:e2e            (needs network for the CDN scripts + hand model)
//   BASE_URL=https://... npm run test:e2e   to test a deployed copy
// Screenshots are written to tests/screenshots/.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../scripts/dev-server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "tests", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✖ ${name}\n      ${String(err.message).split("\n")[0]}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---------- fake webcam: turn a photo into a .y4m video Chrome can play as a camera ----------
async function makeFakeCamera(browser) {
  const page = await browser.newPage();
  const img = fs.readFileSync(path.join(ROOT, "tests/fixtures/hand-open.jpg")).toString("base64");
  const rgba = await page.evaluate(async (b64) => {
    const im = new Image();
    im.src = `data:image/jpeg;base64,${b64}`;
    await im.decode();
    const c = Object.assign(document.createElement("canvas"), { width: 640, height: 480 });
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#d8d6d2";
    ctx.fillRect(0, 0, 640, 480);
    const s = 480 / im.height;
    ctx.drawImage(im, (640 - im.width * s) / 2, 0, im.width * s, 480);
    return Array.from(ctx.getImageData(0, 0, 640, 480).data);
  }, img);
  await page.close();

  const W = 640, H = 480;
  const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4), V = Buffer.alloc(W * H / 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    Y[y * W + x] = 0.257 * r + 0.504 * g + 0.098 * b + 16;
    if (y % 2 === 0 && x % 2 === 0) {
      const j = (y / 2) * (W / 2) + x / 2;
      U[j] = -0.148 * r - 0.291 * g + 0.439 * b + 128;
      V[j] = 0.439 * r - 0.368 * g - 0.071 * b + 128;
    }
  }
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Y, U, V]);
  const file = path.join(os.tmpdir(), "hand-physics-fake-cam.y4m");
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`),
    ...Array(30).fill(frame),
  ]));
  return file;
}

// Canvas pixel (960x720 space) -> page coordinates
async function toPage(page, x, y) {
  const box = await page.locator("#world").boundingBox();
  return { x: box.x + (x / 960) * box.width, y: box.y + (y / 720) * box.height };
}

async function dragBody(page, from, to) {
  const a = await toPage(page, from.x, from.y), b = await toPage(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 30 });
  await page.waitForTimeout(400);
  await page.mouse.up();
}

const main = async () => {
  // Local runs get the dev server with a fresh in-memory leaderboard
  const server = BASE_URL_OR(await startServer());
  const live = !!process.env.BASE_URL; // don't post test scores to the real leaderboard
  const base = server.url;
  console.log(`Testing ${base}`);

  const plain = await chromium.launch();
  const fakeCam = await makeFakeCamera(plain);
  const camBrowser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
           `--use-file-for-fake-video-capture=${fakeCam}`, "--enable-unsafe-swiftshader"],
  });

  // ---------------- desktop, mouse only ----------------
  console.log("\nDesktop (mouse)");
  const ctx = await plain.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await check("page loads with the level menu", async () => {
    await page.goto(base);
    await page.locator("#menu").waitFor({ state: "visible" });
    assert((await page.locator(".level-card").count()) === 6, "6 level cards");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/01-menu.png` });
  });

  await check("first play shows the how-to-play help once", async () => {
    await page.click("#menuMouseBtn");
    await page.locator("#help").waitFor({ state: "visible" });
    await page.screenshot({ path: `${SHOTS}/02-help.png` });
    await page.click("#helpClose");
    assert(await page.locator("#help").isHidden(), "help closed");
    assert((await page.textContent("#levelName")).includes("First Grab"), "on level 1");
  });

  await check("hovering a shape shows a pointer cursor", async () => {
    const ball = await page.evaluate(() => game.refs.ball.position);
    const p = await toPage(page, ball.x, ball.y);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(100);
    assert(await page.locator("#world.pointing").count() === 1, "pointing cursor");
  });

  await check("level 1 can be beaten by dragging with the mouse", async () => {
    const { ball, zone } = await page.evaluate(() => ({ ball: game.refs.ball.position, zone: game.refs.zone }));
    await dragBody(page, ball, { x: zone.x + zone.w / 2, y: zone.y + 60 });
    await page.locator("#winModal").waitFor({ state: "visible", timeout: 5000 });
    assert((await page.locator("#winStars .star.on").count()) >= 1, "stars shown");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/03-win.png` });
  });

  await check("win screen shows the top 5 and asks for a name", async () => {
    await page.waitForFunction(() => !document.getElementById("boardMsg").textContent.includes("Loading"));
    if (live) return; // the live board may already be full of faster times
    assert(await page.locator("#nameForm").isVisible(), "name form shown for a top-5 time");
    assert((await page.textContent("#boardMsg")).includes("claim #1"), await page.textContent("#boardMsg"));
    assert((await page.textContent("#winBoardList")).includes("Be the first"), "empty board message");
  });

  if (!live) await check("submitting a name puts it on the board (shortcut keys don't fire while typing)", async () => {
    await page.click("#nameInput");
    await page.keyboard.type("  Rhm   Tester ");   // r, h, m are game shortcuts
    assert(await page.locator("#winModal").isVisible(), "typing r didn't restart");
    assert(await page.locator("#help").isHidden(), "typing h didn't open help");
    assert((await page.getAttribute("#muteBtn", "aria-pressed")) === "false", "typing m didn't mute");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.getElementById("boardMsg").textContent.includes("#1"));
    assert(await page.locator("#nameForm").isHidden(), "form hidden after submitting");
    const row = page.locator("#winBoardList li.me");
    assert((await row.textContent()).includes("Rhm Tester"), "own row highlighted, spaces tidied");
    await page.screenshot({ path: `${SHOTS}/03b-win-leaderboard.png` });
  });

  await check("next level button loads level 2", async () => {
    await page.click("#winNext");
    assert((await page.textContent("#levelName")).includes("Sky Tower"), "on Sky Tower");
    assert(await page.locator("#winModal").isHidden(), "modal closed");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/04-tower.png` });
  });

  await check("leaderboard overlay shows each level's top 5", async () => {
    await page.click("#boardsBtn");
    await page.locator("#boards").waitFor({ state: "visible" });
    assert((await page.locator("#boardTabs .tab").count()) === 5, "a tab per timed level");
    assert((await page.getAttribute("#boardTabs .tab[data-level=tower]", "aria-selected")) === "true", "opens on current level");
    await page.waitForFunction(() => !document.getElementById("boardsMsg").textContent);
    await page.click("#boardTabs .tab[data-level=first-grab]");
    if (!live) assert((await page.textContent("#boardsList")).includes("Rhm Tester"), "level 1 time listed");
    await page.screenshot({ path: `${SHOTS}/04b-leaderboards.png` });
    await page.keyboard.press("Escape");
    assert(await page.locator("#boards").isHidden(), "Esc closes it");
    await page.keyboard.press("l");
    assert(await page.locator("#boards").isVisible(), "L opens it");
    await page.click("#boardsClose");
  });

  await check("R restarts and keeps the world intact", async () => {
    const before = await page.evaluate(() => game.bodies().length);
    await page.keyboard.press("r");
    await page.keyboard.press("r");
    const after = await page.evaluate(() => game.bodies().length);
    assert(before === after, `${before} vs ${after} bodies`);
  });

  await check("progress is saved and shown in the menu", async () => {
    await page.keyboard.press("Escape");
    await page.locator("#menu").waitFor({ state: "visible" });
    const first = page.locator(".level-card").first();
    assert((await first.locator(".star.on").count()) >= 1, "level 1 shows stars");
    await page.reload();
    // Reloading resumes the level in the URL; the menu is one Esc away
    assert((await page.textContent("#levelName")).includes("Sky Tower"), "resumes current level");
    assert(await page.locator("#help").isHidden(), "help not shown again");
    await page.keyboard.press("Escape");
    await page.locator("#menu").waitFor({ state: "visible" });
    assert((await page.locator(".level-card").first().locator(".star.on").count()) >= 1, "survives reload");
  });

  await check("can't grab inside the out-of-reach zone (Hoop Shot)", async () => {
    await page.locator(".level-card").nth(2).click();
    await page.waitForTimeout(800);
    const p = await toPage(page, 700, 650);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(100);
    assert(await page.evaluate(() => game.heldBody() === null), "nothing held");
    await page.mouse.up();
    await page.screenshot({ path: `${SHOTS}/05-hoop.png` });
  });

  await check("Knockdown and Balancing Act render", async () => {
    await page.keyboard.press("Escape");
    await page.locator(".level-card").nth(3).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SHOTS}/06-knockdown.png` });
    await page.keyboard.press("Escape");
    await page.locator(".level-card").nth(4).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SHOTS}/07-seesaw.png` });
    assert((await page.textContent("#levelStatus")).includes("On seesaw"), "seesaw status text");
  });

  await check("Free Play spawn + clear buttons work", async () => {
    await page.keyboard.press("Escape");
    await page.locator(".level-card").nth(5).click();
    assert(await page.locator("#spawnBar").isVisible(), "spawn bar visible");
    assert(await page.locator("#timer").isHidden(), "no timer in sandbox");
    const n = await page.evaluate(() => game.grabbables().length);
    await page.click("[data-spawn=block]");
    await page.click("[data-spawn=ball]");
    await page.click("[data-spawn=plank]");
    assert((await page.evaluate(() => game.grabbables().length)) === n + 3, "3 spawned");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/08-sandbox.png` });
    await page.click("#clearBtn");
    assert((await page.evaluate(() => game.grabbables().length)) === 0, "cleared");
  });

  await check("mute toggle persists", async () => {
    await page.click("#muteBtn");
    assert((await page.getAttribute("#muteBtn", "aria-pressed")) === "true", "shows muted");
    await page.reload();
    assert((await page.getAttribute("#muteBtn", "aria-pressed")) === "true", "still muted after reload");
    await page.click("#muteBtn");
  });

  await check("#level-id links open that level directly", async () => {
    const fresh = await ctx.newPage();
    await fresh.goto(`${base}#knockdown`);
    await fresh.waitForTimeout(300);
    assert(await fresh.locator("#menu").isHidden(), "menu skipped");
    assert((await fresh.textContent("#levelName")).includes("Knockdown"), "deep link to knockdown");
    await fresh.evaluate(() => { location.hash = "#hoop"; });
    await fresh.waitForTimeout(200);
    assert((await fresh.textContent("#levelName")).includes("Hoop"), "hash change switches level");
    await fresh.close();
  });

  await check("no JavaScript errors on desktop", async () => {
    assert(errors.length === 0, errors.join(" | "));
  });
  await ctx.close();

  // ---------------- camera denied ----------------
  console.log("\nCamera permission denied");
  await check("shows a helpful message and mouse still works", async () => {
    const c = await plain.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await c.newPage();
    // Simulate the user clicking "Block" on the permission prompt
    await p.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
    await p.goto(base);
    await p.click("#menuCamBtn");
    if (await p.locator("#help").isVisible()) await p.click("#helpClose");
    await p.waitForFunction(() => document.getElementById("toast").classList.contains("show"));
    const msg = await p.textContent("#toast");
    assert(msg.includes("blocked") && msg.includes("mouse"), msg);
    assert((await p.textContent("#camBtn")).includes("Use hand"), "button reset");
    await p.screenshot({ path: `${SHOTS}/09-camera-denied.png` });
    await c.close();
  });

  // ---------------- leaderboard offline ----------------
  console.log("\nLeaderboard offline");
  await check("winning still works and the win screen explains", async () => {
    const c = await plain.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await c.newPage();
    const pErrors = [];
    p.on("pageerror", (e) => pErrors.push(e.message));
    await p.route("**/api/leaderboard*", (route) => route.abort());
    await p.goto(`${base}#first-grab`);
    if (await p.locator("#help").isVisible()) await p.click("#helpClose");
    const { ball, zone } = await p.evaluate(() => ({ ball: game.refs.ball.position, zone: game.refs.zone }));
    await dragBody(p, ball, { x: zone.x + zone.w / 2, y: zone.y + 60 });
    await p.locator("#winModal").waitFor({ state: "visible", timeout: 5000 });
    await p.waitForFunction(() => document.getElementById("boardMsg").textContent.includes("Couldn't reach"));
    assert(await p.locator("#nameForm").isHidden(), "no name form");
    await p.keyboard.press("l");
    await p.waitForFunction(() => document.getElementById("boardsMsg").textContent.includes("Couldn't reach"));
    await p.screenshot({ path: `${SHOTS}/09b-leaderboard-offline.png` });
    assert(pErrors.length === 0, pErrors.join(" | "));
    await c.close();
  });

  // ---------------- real hand tracking with a fake webcam ----------------
  console.log("\nHand tracking (fake webcam showing a real hand photo)");
  await check("model loads, finds the hand, draws the skeleton", async () => {
    const c = await camBrowser.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await c.newPage();
    const camErrors = [];
    p.on("pageerror", (e) => camErrors.push(e.message));
    await p.goto(base);
    await p.click("#menuCamBtn");
    if (await p.locator("#help").isVisible()) await p.click("#helpClose");
    await p.waitForFunction(() => document.getElementById("camBtn").textContent.includes("Hand on"), null, { timeout: 60000 });
    await p.waitForFunction(() => document.getElementById("handStatus").textContent.includes("Hand found"), null, { timeout: 30000 });
    await p.waitForTimeout(1000);
    await p.screenshot({ path: `${SHOTS}/10-hand-tracking.png` });
    // The open "victory" hand must not count as a pinch
    assert(!(await p.textContent("#handStatus")).includes("Pinching"), "open hand is not a pinch");
    // Turning the camera off cleans up
    await p.click("#camBtn");
    assert((await p.textContent("#camBtn")).includes("Use hand"), "camera off");
    assert(await p.evaluate(() => document.getElementById("video").srcObject === null), "stream released");
    assert(camErrors.length === 0, camErrors.join(" | "));
    await c.close();
  });

  // ---------------- phone ----------------
  console.log("\nPhone (390x844, touch)");
  await check("fits a phone screen with no sideways scrolling", async () => {
    const c = await plain.newContext({ ...{ viewport: { width: 390, height: 844 } }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const p = await c.newPage();
    const mErrors = [];
    p.on("pageerror", (e) => mErrors.push(e.message));
    await p.goto(base);
    await p.screenshot({ path: `${SHOTS}/11-phone-menu.png` });
    await p.tap("#menuMouseBtn");
    await p.tap("#helpClose");
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${SHOTS}/12-phone-game.png` });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `page is ${overflow}px too wide`);
    // A touch drag beats level 1 on a phone too
    const { ball, zone } = await p.evaluate(() => ({ ball: game.refs.ball.position, zone: game.refs.zone }));
    const a = await toPage(p, ball.x, ball.y), b = await toPage(p, zone.x + zone.w / 2, zone.y + 60);
    const cdp = await c.newCDPSession(p);
    const touch = (type, pt) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pt ? [{ x: pt.x, y: pt.y }] : [] });
    await touch("touchStart", a);
    for (let i = 1; i <= 20; i++) await touch("touchMove", { x: a.x + (b.x - a.x) * i / 20, y: a.y + (b.y - a.y) * i / 20 });
    await p.waitForTimeout(400);
    await touch("touchEnd");
    await p.locator("#winModal").waitFor({ state: "visible", timeout: 5000 });
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${SHOTS}/13-phone-win.png` });
    assert(mErrors.length === 0, mErrors.join(" | "));
    await c.close();
  });

  await plain.close();
  await camBrowser.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll browser checks passed");
  process.exit(failures ? 1 : 0);
};

// Use BASE_URL if given (deployed site), otherwise the local server.
function BASE_URL_OR(local) {
  if (process.env.BASE_URL) { local.close(); return { url: process.env.BASE_URL, close() {} }; }
  return { url: `http://localhost:${local.address().port}/`, close: () => local.close() };
}

main().catch((e) => { console.error(e); process.exit(1); });
