// Matter.js world: walls, blocks, the goal line, and a "hand grab" constraint.
const { Engine, Render, Runner, Bodies, Body, Composite, Constraint, Query,
        Mouse, MouseConstraint } = Matter;

export const WIDTH = 960;
export const HEIGHT = 720;
export const GOAL_Y = 260; // blocks must stay above this line to win

const COLORS = ["#f6c945", "#ef6f6c", "#5bc0a8", "#8c7cf0", "#f49b4a"];

export function createWorld(canvas) {
  const engine = Engine.create();
  const render = Render.create({
    canvas,
    engine,
    options: { width: WIDTH, height: HEIGHT, wireframes: false, background: "transparent" },
  });
  Render.run(render);
  Runner.run(Runner.create(), engine);

  // Mouse/touch fallback so the toy still works without a webcam.
  const mouse = Mouse.create(canvas);
  mouse.pixelRatio = 1;
  const mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.2, render: { visible: false } },
  });
  Composite.add(engine.world, mouseConstraint);
  render.mouse = mouse;

  // The canvas is drawn at 960x720 but stretched by CSS, so rescale mouse coords.
  const fitMouse = () => Mouse.setScale(mouse, {
    x: WIDTH / canvas.clientWidth, y: HEIGHT / canvas.clientHeight });
  fitMouse();
  window.addEventListener("resize", fitMouse);

  return { engine, render, mouseConstraint };
}

export function loadLevel(engine, mouseConstraint) {
  Composite.clear(engine.world, false);
  Composite.add(engine.world, mouseConstraint); // clear() removed it, so put it back
  const wall = { isStatic: true, render: { fillStyle: "#3a3f55" } };
  Composite.add(engine.world, [
    Bodies.rectangle(WIDTH / 2, HEIGHT + 30, WIDTH * 2, 80, wall), // floor
    Bodies.rectangle(-30, HEIGHT / 2, 60, HEIGHT * 3, wall),        // left
    Bodies.rectangle(WIDTH + 30, HEIGHT / 2, 60, HEIGHT * 3, wall), // right
  ]);

  // A pile of blocks on the right side to build with.
  for (let i = 0; i < 10; i++) {
    const w = 60 + Math.random() * 60;
    const h = 40 + Math.random() * 30;
    const block = Bodies.rectangle(620 + Math.random() * 260, 100 + i * 50, w, h, {
      friction: 0.8,
      render: { fillStyle: COLORS[i % COLORS.length] },
    });
    block.label = "block";
    Composite.add(engine.world, block);
  }
}

export function blocks(engine) {
  return Composite.allBodies(engine.world).filter((b) => b.label === "block");
}

// ---- Hand grabbing ----
let grab = null; // the active Constraint, or null

export function handGrab(engine, x, y) {
  if (grab) return;
  const [body] = Query.point(blocks(engine), { x, y });
  if (!body) return;
  grab = Constraint.create({
    pointA: { x, y },
    bodyB: body,
    // Hold the block at the exact spot that was pinched, not its center.
    pointB: { x: x - body.position.x, y: y - body.position.y },
    stiffness: 0.15,
    damping: 0.1,
    render: { visible: false },
  });
  Composite.add(engine.world, grab);
}

export function handMove(x, y) {
  if (grab) grab.pointA = { x, y };
}

export function handRelease(engine) {
  if (!grab) return;
  Composite.remove(engine.world, grab);
  grab = null; // the block keeps its velocity, so fast releases become throws
}

export function isGrabbing() {
  return grab !== null;
}
