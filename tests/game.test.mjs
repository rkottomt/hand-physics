// Headless tests: run the real game + levels in Node with Matter.js, no browser needed.
//   npm test
import test from "node:test";
import assert from "node:assert/strict";
import MatterLib from "matter-js";

globalThis.Matter = MatterLib; // game.js expects the browser global
const { Game, starsFor } = await import("../js/game.js");
const { LEVELS } = await import("../js/levels.js");
const { WIDTH, HEIGHT } = await import("../js/constants.js");
const { pinchRatio, nextPinch, coverMap, smooth } = await import("../js/gesture.js");
const { Body, Engine } = MatterLib;

const STEP = 1000 / 60;
const idx = (id) => LEVELS.findIndex((l) => l.id === id);

function setup(id) {
  const game = new Game();
  const wins = [];
  game.on("win", (w) => wins.push(w));
  game.load(idx(id));
  return { game, wins };
}

function step(game, ms) {
  for (let t = 0; t < ms; t += STEP) Engine.update(game.engine, STEP);
}

// Simulate a hand: grab a body, move to (x, y) over `frames`, let go.
function drag(game, body, x, y, frames = 40) {
  const sx = body.position.x, sy = body.position.y;
  assert.ok(game.grabAt(sx, sy), "should be able to grab the body");
  for (let i = 1; i <= frames; i++) {
    game.moveGrab(sx + ((x - sx) * i) / frames, sy + ((y - sy) * i) / frames);
    Engine.update(game.engine, STEP);
  }
  step(game, 300); // hold still so it stops swinging
  game.release();
}

function place(body, x, y) {
  Body.setPosition(body, { x, y });
  Body.setAngle(body, 0);
  Body.setVelocity(body, { x: 0, y: 0 });
  Body.setAngularVelocity(body, 0);
}

// ---------- gestures ----------
test("pinch ratio and hysteresis", () => {
  const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  hand[0] = { x: 0.5, y: 0.8 }; hand[9] = { x: 0.5, y: 0.6 }; // hand size 0.2
  hand[4] = { x: 0.40, y: 0.5 }; hand[8] = { x: 0.46, y: 0.5 }; // gap 0.06
  assert.ok(Math.abs(pinchRatio(hand) - 0.3) < 1e-9);
  assert.equal(nextPinch(false, 0.3), true);   // closes below 0.35
  assert.equal(nextPinch(false, 0.4), false);  // not yet
  assert.equal(nextPinch(true, 0.4), true);    // stays held in the dead band
  assert.equal(nextPinch(true, 0.55), false);  // opens above 0.5
});

test("coverMap matches object-fit: cover", () => {
  // 4:3 video on a 4:3 canvas maps straight across
  assert.deepEqual(coverMap(0.5, 0.5, 640, 480, WIDTH, HEIGHT), { x: 480, y: 360 });
  // 16:9 video is cropped left/right, so the visible center is unchanged but edges move off-screen
  const left = coverMap(0, 0.5, 1280, 720, WIDTH, HEIGHT);
  assert.ok(left.x < 0);
  assert.equal(coverMap(0.5, 0.5, 1280, 720, WIDTH, HEIGHT).x, 480);
});

test("smoothing moves part-way toward the target", () => {
  assert.deepEqual(smooth(null, { x: 1, y: 1 }), { x: 1, y: 1 });
  assert.deepEqual(smooth({ x: 0, y: 0 }, { x: 1, y: 1 }, 0.5), { x: 0.5, y: 0.5 });
});

test("stars by time", () => {
  assert.equal(starsFor(5, 10), 3);
  assert.equal(starsFor(15, 10), 2);
  assert.equal(starsFor(25, 10), 1);
});

// ---------- every level ----------
for (const level of LEVELS) {
  test(`${level.id}: loads, settles, and is not won by doing nothing`, () => {
    const { game, wins } = setup(level.id);
    const before = game.grabbables().length;
    assert.ok(before > 0, "has something to grab");
    step(game, 8000);
    assert.equal(wins.length, 0, "no free win");
    assert.equal(game.grabbables().length, before);
    for (const b of game.grabbables()) {
      assert.ok(b.position.x > 0 && b.position.x < WIDTH && b.position.y < HEIGHT,
        `body stays on screen (${b.position.x.toFixed(0)}, ${b.position.y.toFixed(0)})`);
    }
    assert.equal(game.elapsed(), 0, "timer waits for first grab");
  });

  test(`${level.id}: restart rebuilds the same world`, () => {
    const { game } = setup(level.id);
    const count = game.bodies().length;
    game.grabAt(game.grabbables()[0].position.x, game.grabbables()[0].position.y);
    step(game, 500);
    game.restart();
    game.restart();
    assert.equal(game.bodies().length, count);
    assert.equal(game.heldBody(), null);
  });
}

// ---------- each level can actually be beaten ----------
test("first-grab: dragging the ball into the zone wins", () => {
  const { game, wins } = setup("first-grab");
  const { ball, zone } = game.refs;
  drag(game, ball, zone.x + zone.w / 2, zone.y + 40);
  step(game, 3000);
  assert.equal(wins.length, 1);
  assert.ok(wins[0].seconds > 0);
  assert.ok([1, 2, 3].includes(wins[0].stars));
  assert.equal(game.heldBody(), null);
});

test("first-grab: holding the ball in the zone does not count", () => {
  const { game, wins } = setup("first-grab");
  const { ball, zone } = game.refs;
  game.grabAt(ball.position.x, ball.position.y);
  for (let i = 0; i < 60; i++) { game.moveGrab(zone.x + zone.w / 2, zone.y + zone.h - 40); step(game, STEP); }
  step(game, 2000);
  assert.equal(wins.length, 0);
});

test("tower: a 5-block stack over the line wins, a 3-block stack doesn't", () => {
  let { game, wins } = setup("tower");
  let blocks = game.grabbables().sort((a, b) => (b.bounds.max.x - b.bounds.min.x) - (a.bounds.max.x - a.bounds.min.x));
  let y = 700;
  for (const blk of blocks.slice(0, 3)) {
    const h = blk.bounds.max.y - blk.bounds.min.y;
    place(blk, 250, y - h / 2 - 1); y -= h + 1;
  }
  step(game, 5000);
  assert.equal(wins.length, 0, "3 blocks are too short");

  ({ game, wins } = setup("tower"));
  blocks = game.grabbables().sort((a, b) => (b.bounds.max.x - b.bounds.min.x) - (a.bounds.max.x - a.bounds.min.x));
  y = 700;
  for (const blk of blocks.slice(0, 5)) {
    const h = blk.bounds.max.y - blk.bounds.min.y;
    place(blk, 250, y - h / 2 - 1); y -= h + 1;
  }
  game.startTime = game.now();
  step(game, 6000);
  assert.equal(wins.length, 1, "5 blocks reach the goal and the stack is stable");
});

test("hoop: can't grab past the red line", () => {
  const { game } = setup("hoop");
  assert.equal(game.canReach(600), false);
  assert.equal(game.grabAt(600, 600), null);
});

test("hoop: carrying across the red line forces a release (a throw)", () => {
  const { game } = setup("hoop");
  const { ball } = game.refs;
  let outOfReach = 0;
  game.on("outOfReach", () => outOfReach++);
  game.grabAt(ball.position.x, ball.position.y);
  for (let x = ball.position.x; x < 520; x += 20) { game.moveGrab(x, 400); step(game, STEP); }
  assert.equal(outOfReach, 1);
  assert.equal(game.heldBody(), null);
});

test("hoop: some realistic throw lands in the basket", () => {
  let found = null;
  for (let vx = 8; vx <= 24 && !found; vx += 1) {
    for (let vy = -10; vy >= -26 && !found; vy -= 1) {
      const { game, wins } = setup("hoop");
      const { ball } = game.refs;
      place(ball, 400, 450);
      Body.setVelocity(ball, { x: vx, y: vy });
      game.startTime = game.now();
      step(game, 4000);
      if (wins.length) found = { vx, vy };
    }
  }
  assert.ok(found, "at least one throw scores");
});

test("hoop: a ball stuck out of reach rolls back home", () => {
  const { game } = setup("hoop");
  const { ball } = game.refs;
  place(ball, 600, 650);
  step(game, 2500);
  assert.ok(ball.position.x < 470, "ball returned to the reachable side");
});

test("knockdown: hitting every target wins", () => {
  const { game, wins } = setup("knockdown");
  const boulders = game.grabbables();
  game.startTime = game.now();
  game.refs.targets.forEach((t, i) => {
    // Fling a boulder sideways into each target
    place(boulders[i], t.position.x - 70, t.position.y);
    Body.setVelocity(boulders[i], { x: 18, y: -2 });
  });
  step(game, 4000);
  assert.equal(wins.length, 1);
});

test("seesaw: balanced blocks win, lopsided ones don't", () => {
  let { game, wins } = setup("seesaw");
  let { plank, px } = game.refs;
  let light = game.grabbables().filter((b) => b.density < 0.002);
  // all four light blocks on one side → tilts
  light.forEach((b, i) => place(b, px + 150 + (i % 2) * 90, 470 - Math.floor(i / 2) * 55));
  step(game, 5000);
  assert.equal(wins.length, 0, "lopsided load tilts the plank");

  ({ game, wins } = setup("seesaw"));
  ({ plank, px } = game.refs);
  light = game.grabbables().filter((b) => b.density < 0.002);
  const offsets = [-200, 200, -100, 100];
  light.forEach((b, i) => place(b, px + offsets[i], plank.position.y - 8 - 26));
  game.startTime = game.now();
  step(game, 6000);
  assert.equal(wins.length, 1, `balanced load wins (tilt ${(plank.angle * 57.3).toFixed(1)}°)`);
});

// ---------- general rules ----------
test("bodies that fall out of the world respawn", () => {
  const { game } = setup("sandbox");
  const b = game.grabbables()[0];
  place(b, WIDTH / 2, HEIGHT + 500);
  step(game, STEP * 2);
  assert.ok(b.position.y < HEIGHT, "back in the world");
});

test("grab is forgiving near a body but not far away", () => {
  const { game } = setup("first-grab");
  const { ball } = game.refs;
  assert.equal(game.bodyAt(ball.bounds.max.x + 20, ball.position.y), ball);
  assert.equal(game.bodyAt(ball.bounds.max.x + 80, ball.position.y), null);
});

test("throw speed is capped on release", () => {
  const { game } = setup("sandbox");
  const b = game.grabbables()[0];
  game.grabAt(b.position.x, b.position.y);
  Body.setVelocity(b, { x: 200, y: 0 });
  game.release();
  assert.ok(MatterLib.Vector.magnitude(b.velocity) <= 32.001);
});

test("no grabbing after a win", () => {
  const { game, wins } = setup("first-grab");
  const { ball, zone } = game.refs;
  drag(game, ball, zone.x + zone.w / 2, zone.y + 40);
  step(game, 3000);
  assert.equal(wins.length, 1);
  assert.equal(game.grabAt(ball.position.x, ball.position.y), null);
});

test("sandbox: spawning is capped so it can't lag forever", () => {
  const { game } = setup("sandbox");
  for (let i = 0; i < 80; i++) game.spawn(["block", "ball", "plank"][i % 3]);
  assert.ok(game.grabbables().length <= 41);
  game.clearShapes();
  assert.equal(game.grabbables().length, 0);
});
