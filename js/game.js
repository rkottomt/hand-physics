// DOM-free game logic: owns the Matter.js engine, loads levels, handles grabbing,
// and decides when a level is won. main.js draws it and feeds it input.
// (No DOM here, so tests/game.test.mjs can run every level headlessly in Node.)
import { WIDTH, HEIGHT, FLOOR_Y } from "./constants.js";
import { LEVELS } from "./levels.js";

const { Engine, Bodies, Body, Composite, Constraint, Query, Events, Vector } = Matter;

const PICK_RADIUS = 30;      // forgiving grab: snap to a body this close to the cursor
const MAX_THROW_SPEED = 32;  // cap release speed so bodies can't tunnel through walls
const REST_SPEED = 0.35;     // below this a body counts as "resting"
const STRANDED_MS = 1500;    // bodies stuck out of reach return home after this long
const SANDBOX_LIMIT = 40;
const COLORS = ["#f6c945", "#ef6f6c", "#5bc0a8", "#8c7cf0", "#f49b4a", "#4fb3f6"];

export function starsFor(seconds, par) {
  if (seconds <= par) return 3;
  if (seconds <= par * 2) return 2;
  return 1;
}

export class Game {
  constructor() {
    this.engine = Engine.create();
    this.engine.positionIterations = 10; // steadier stacks
    this.engine.velocityIterations = 8;
    this.world = this.engine.world;
    this.handlers = {};
    this.grab = null;
    this.level = null;
    Events.on(this.engine, "afterUpdate", () => this.update());
  }

  on(name, fn) { (this.handlers[name] ??= []).push(fn); }
  emit(name, data) { (this.handlers[name] ?? []).forEach((fn) => fn(data)); }

  // Simulation time (ms). Using the engine clock keeps tests deterministic.
  now() { return this.engine.timing.timestamp; }

  load(index) {
    this.grab = null;
    Composite.clear(this.world, false); // removes bodies AND constraints (incl. any grab)
    this.levelIndex = index;
    this.level = LEVELS[index];
    this.zones = [];
    this.goalY = null;
    this.grabMaxX = Infinity;
    this.startTime = null;
    this.holdStart = null;
    this.holdProgress = 0;
    this.won = false;
    this.status = "";
    this.addWalls();
    this.builder = this.makeBuilder();
    this.refs = this.level.build(this.builder) ?? {};
    this.emit("load", this.level);
  }

  restart() { this.load(this.levelIndex); }

  addWalls() {
    const wall = { isStatic: true, render: { fillStyle: "#3a3f55" } };
    Composite.add(this.world, [
      Bodies.rectangle(WIDTH / 2, FLOOR_Y + 60, WIDTH * 3, 120, wall),      // floor
      Bodies.rectangle(-40, HEIGHT / 2 - 400, 80, HEIGHT * 3, wall),        // left
      Bodies.rectangle(WIDTH + 40, HEIGHT / 2 - 400, 80, HEIGHT * 3, wall), // right
    ]);
  }

  // The toolkit each level's build() uses to create its world.
  makeBuilder() {
    let colorIndex = 0;
    const add = (thing) => { Composite.add(this.world, thing); return thing; };
    const grabbable = (body, color) => {
      body.grabbable = true;
      body.spawn = { x: body.position.x, y: body.position.y, angle: body.angle };
      body.render.fillStyle = color ?? COLORS[colorIndex++ % COLORS.length];
      return add(body);
    };
    return {
      add,
      block: (x, y, w, h, o = {}) => grabbable(Bodies.rectangle(x, y, w, h, {
        friction: 0.8, frictionStatic: 1, density: o.density ?? 0.001,
        angle: o.angle ?? 0, chamfer: { radius: 4 },
      }), o.color),
      ball: (x, y, r, o = {}) => grabbable(Bodies.circle(x, y, r, {
        friction: 0.4, restitution: o.bounce ?? 0.3, density: o.density ?? 0.001,
      }), o.color),
      wall: (x, y, w, h, o = {}) => add(Bodies.rectangle(x, y, w, h, {
        isStatic: true, isSensor: !!o.decorative, angle: o.angle ?? 0,
        render: { fillStyle: o.color ?? "#3a3f55" },
      })),
      target: (x, y, r) => {
        const t = add(Bodies.circle(x, y, r, {
          density: 0.0006, friction: 0.6,
          render: { fillStyle: "#ff4d6d", strokeStyle: "#ffffff", lineWidth: 3 },
        }));
        t.isTarget = true;
        t.spawn = { x, y };
        return t;
      },
      pivot: (body, x, y) => add(Constraint.create({
        pointA: { x, y }, bodyB: body, length: 0, stiffness: 1, render: { visible: false },
      })),
      zone: (x, y, w, h, label = "") => { const z = { x, y, w, h, label }; this.zones.push(z); return z; },
      goalLine: (y) => { this.goalY = y; },
      noGrabFrom: (x) => { this.grabMaxX = x; },
    };
  }

  // ---------- queries ----------
  bodies() { return Composite.allBodies(this.world); }
  grabbables() { return this.bodies().filter((b) => b.grabbable); }
  heldBody() { return this.grab ? this.grab.bodyB : null; }
  isResting(b) { return b.speed < REST_SPEED && b !== this.heldBody(); }
  inZone(b, z) {
    return b.position.x > z.x && b.position.x < z.x + z.w &&
           b.position.y > z.y && b.position.y < z.y + z.h;
  }
  canReach(x) { return x < this.grabMaxX; }

  // Body under (x, y), or failing that the nearest one within PICK_RADIUS.
  bodyAt(x, y) {
    const candidates = this.grabbables();
    const [hit] = Query.point(candidates, { x, y });
    if (hit) return hit;
    let best = null, bestD = PICK_RADIUS;
    for (const b of candidates) {
      const dx = Math.max(b.bounds.min.x - x, 0, x - b.bounds.max.x);
      const dy = Math.max(b.bounds.min.y - y, 0, y - b.bounds.max.y);
      const d = Math.hypot(dx, dy);
      if (d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  elapsed() {
    if (this.startTime === null) return 0;
    return ((this.won ? this.wonAt : this.now()) - this.startTime) / 1000;
  }

  // ---------- grabbing ----------
  grabAt(x, y) {
    if (this.grab || !this.canReach(x) || this.won) return null;
    const body = this.bodyAt(x, y);
    if (!body) return null;
    // Hold the body at the point that was grabbed (clamped onto it), not its center.
    const px = Math.min(Math.max(x, body.bounds.min.x), body.bounds.max.x);
    const py = Math.min(Math.max(y, body.bounds.min.y), body.bounds.max.y);
    this.grab = Constraint.create({
      pointA: { x, y },
      bodyB: body,
      pointB: { x: px - body.position.x, y: py - body.position.y },
      length: 0,
      stiffness: 0.2,
      damping: 0.1,
      render: { visible: false },
    });
    body.frictionAir = 0.05; // calmer spinning while held
    Composite.add(this.world, this.grab);
    this.startTime ??= this.now(); // the clock starts on your first grab
    this.emit("grab", body);
    return body;
  }

  moveGrab(x, y) {
    if (!this.grab) return;
    if (!this.canReach(x)) {
      // Crossing the red line lets go, so the body flies on with your hand's speed: a throw.
      this.release();
      this.emit("outOfReach");
      return;
    }
    this.grab.pointA = { x, y };
  }

  release() {
    if (!this.grab) return null;
    const body = this.grab.bodyB;
    Composite.remove(this.world, this.grab);
    this.grab = null;
    body.frictionAir = 0.01;
    const speed = Vector.magnitude(body.velocity);
    if (speed > MAX_THROW_SPEED) {
      Body.setVelocity(body, Vector.mult(body.velocity, MAX_THROW_SPEED / speed));
    }
    this.emit("release", body);
    return body;
  }

  respawn(body) {
    if (body === this.heldBody()) this.release();
    Body.setPosition(body, { x: body.spawn.x, y: body.spawn.y });
    Body.setAngle(body, body.spawn.angle ?? 0);
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);
    body.strandedSince = null;
    this.emit("respawn", body);
  }

  // Free Play: drop a new shape in from the top.
  spawn(kind) {
    const x = 120 + Math.random() * (WIDTH - 240);
    const b = this.builder;
    let body;
    if (kind === "ball") body = b.ball(x, 60, 22 + Math.random() * 18);
    else if (kind === "plank") body = b.block(x, 60, 220, 18);
    else body = b.block(x, 60, 50 + Math.random() * 60, 40 + Math.random() * 30);
    const all = this.grabbables();
    if (all.length > SANDBOX_LIMIT) Composite.remove(this.world, all.find((x) => x !== this.heldBody()));
    return body;
  }

  clearShapes() {
    this.release();
    for (const b of this.grabbables()) Composite.remove(this.world, b);
  }

  // ---------- per-step rules (runs after every physics step) ----------
  update() {
    if (!this.level) return;
    const t = this.now();

    for (const b of this.grabbables()) {
      const lost = b.position.y > HEIGHT + 200 || b.position.y < -1500 ||
                   b.position.x < -200 || b.position.x > WIDTH + 200;
      if (lost) { this.respawn(b); continue; }

      // Never leave the player stuck: bodies resting out of reach come back.
      if (!this.won && b.position.x > this.grabMaxX && this.isResting(b)) {
        b.strandedSince ??= t;
        if (t - b.strandedSince > STRANDED_MS) this.respawn(b);
      } else {
        b.strandedSince = null;
      }
    }

    this.level.tick?.(this, this.refs);

    if (this.won || this.level.sandbox) return;
    const { met, text } = this.level.check(this, this.refs);
    this.status = text ?? "";
    if (met) {
      this.holdStart ??= t;
      this.holdProgress = Math.min(1, (t - this.holdStart) / this.level.holdMs);
      if (this.holdProgress >= 1) this.win();
    } else {
      this.holdStart = null;
      this.holdProgress = 0;
    }
  }

  win() {
    this.won = true;
    this.wonAt = this.now();
    this.release();
    const seconds = this.elapsed();
    this.emit("win", { level: this.level, index: this.levelIndex, seconds,
                       stars: starsFor(seconds, this.level.par) });
  }
}
