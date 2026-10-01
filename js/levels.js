// Level definitions. Each level is plain data plus two functions:
//   build(b)          -> creates the level using the builder from game.js, returns "refs"
//   check(game, refs) -> { met, text }  — met must stay true for holdMs to win
// par is the 3-star time in seconds (the clock starts on your first grab).
import { WIDTH, FLOOR_Y } from "./constants.js";

const SPRING = 0.0016; // seesaw: how hard it pulls back toward level (tuned in tests)
const DAMPING = 0.15;  // seesaw: fraction of spin removed each step, stops wobbling

const onFloor = (height) => FLOOR_Y - height / 2;

export const LEVELS = [
  {
    id: "first-grab",
    name: "First Grab",
    icon: "🤏",
    goal: "Pick up the ball and drop it in the glowing zone.",
    tip: "Pinch your thumb and index finger to grab. Open your hand to let go.",
    par: 8,
    holdMs: 800,
    build(b) {
      const ball = b.ball(220, onFloor(72), 36, { color: "#f6c945" });
      const zone = b.zone(650, FLOOR_Y - 170, 230, 170, "DROP HERE");
      return { ball, zone };
    },
    check(game, { ball, zone }) {
      return { met: game.isResting(ball) && game.inZone(ball, zone) };
    },
  },

  {
    id: "tower",
    name: "Sky Tower",
    icon: "🏗️",
    goal: "Stack blocks until one rests above the dashed line for 3 seconds.",
    tip: "Move slowly while placing. Wide blocks make a better base.",
    par: 35,
    holdMs: 3000,
    build(b) {
      b.goalLine(FLOOR_Y - 215);
      const sizes = [[115, 48], [110, 46], [100, 48], [115, 50], [95, 46], [105, 44], [90, 48], [100, 46]];
      sizes.forEach(([w, h], i) => {
        const col = i % 4, row = Math.floor(i / 4);
        b.block(530 + col * 120, FLOOR_Y - h / 2 - row * 56 - 2, w, h);
      });
    },
    check(game) {
      const above = game.grabbables().filter(
        (blk) => blk.bounds.min.y < game.goalY && game.isResting(blk)
      );
      const top = Math.min(...game.grabbables().map((blk) => blk.bounds.min.y));
      const pct = Math.max(0, Math.min(100, Math.round(((FLOOR_Y - top) / (FLOOR_Y - game.goalY)) * 100)));
      return { met: above.length > 0, text: `Tower height: ${pct}%` };
    },
  },

  {
    id: "hoop",
    name: "Hoop Shot",
    icon: "🏀",
    goal: "Throw the ball into the basket. You can't reach past the red line!",
    tip: "Swing toward the basket and let go mid-swing — or just carry it across the line.",
    par: 12,
    holdMs: 600,
    build(b) {
      b.noGrabFrom(470);
      const ball = b.ball(200, onFloor(56), 28, { color: "#f49b4a", density: 0.002, bounce: 0.45 });
      const cx = 770, bottom = 380, inner = 130, wallH = 90;
      b.wall(cx, (bottom + FLOOR_Y) / 2, 14, FLOOR_Y - bottom, { color: "#2b2f40" }); // pole
      b.wall(cx, bottom, inner + 24, 14, { color: "#c45a2a" });                        // cup floor
      b.wall(cx - inner / 2 - 6, bottom - wallH / 2, 12, wallH, { color: "#c45a2a" }); // left rim
      b.wall(cx + inner / 2 + 6, bottom - wallH / 2, 12, wallH, { color: "#c45a2a" }); // right rim
      const zone = b.zone(cx - inner / 2, bottom - wallH, inner, wallH - 7);
      return { ball, zone };
    },
    check(game, { ball, zone }) {
      return { met: game.inZone(ball, zone) && game.isResting(ball) };
    },
  },

  {
    id: "knockdown",
    name: "Knockdown",
    icon: "🎯",
    goal: "Throw boulders to knock all 3 red targets off their shelves.",
    tip: "Boulders are heavy — a firm throw works best. Missed ones roll back to you.",
    par: 20,
    holdMs: 400,
    build(b) {
      b.noGrabFrom(420);
      const shelves = [[600, 470, 130], [760, 320, 130], [835, 580, 100]];
      const targets = shelves.map(([x, y, w]) => {
        b.wall(x, y, w, 14, { color: "#6b7089" });
        return b.target(x, y - 7 - 26, 26);
      });
      for (let i = 0; i < 4; i++) {
        b.ball(70 + i * 85, onFloor(60), 30, { density: 0.004, color: "#8a8f9e" });
      }
      return { targets };
    },
    check(game, { targets }) {
      // A target counts as knocked once it has dropped or slid well away from its spot.
      const standing = targets.filter(
        (t) => t.position.y < t.spawn.y + 40 && Math.abs(t.position.x - t.spawn.x) < 80
      ).length;
      return { met: standing === 0, text: `Targets left: ${standing}` };
    },
  },

  {
    id: "seesaw",
    name: "Balancing Act",
    icon: "⚖️",
    goal: "Rest 4 blocks on the seesaw and keep it level for 3 seconds.",
    tip: "Dark blocks are heavy. Balance them by putting them closer to the middle.",
    par: 45,
    holdMs: 3000,
    build(b) {
      const px = WIDTH / 2, py = 520;
      b.wall(px, (py + FLOOR_Y) / 2 + 8, 26, FLOOR_Y - py - 16, { decorative: true, color: "#2b2f40" });
      const plank = b.add(Matter.Bodies.rectangle(px, py, 560, 16, {
        density: 0.002, friction: 1, frictionStatic: 2, render: { fillStyle: "#c9a66b" },
      }));
      b.pivot(plank, px, py);
      const heavy = { density: 0.003, color: "#4b3fa8" };
      b.block(70, onFloor(50), 90, 50);
      b.block(70, onFloor(50) - 54, 80, 50, heavy);
      b.block(170, onFloor(50), 70, 50);
      b.block(800, onFloor(50), 90, 50);
      b.block(900, onFloor(50), 70, 50, heavy);
      b.block(850, onFloor(50) - 54, 80, 50);
      return { plank, px, py };
    },
    check(game, { plank, px }) {
      const on = game.grabbables().filter(
        (blk) => game.isResting(blk) && blk.position.y < plank.position.y && Math.abs(blk.position.x - px) < 285
      ).length;
      const tilt = Math.abs(plank.angle * 180 / Math.PI);
      return {
        met: on >= 4 && tilt < 6,
        text: `On seesaw: ${Math.min(on, 4)}/4 · Tilt: ${tilt.toFixed(0)}°${tilt >= 6 ? " (needs < 6°)" : " ✓"}`,
      };
    },
    // A spring under the plank pulls it back toward level (with damping so it doesn't wobble).
    // Without it, blocks resting above the pivot make it tip over no matter how well balanced.
    tick(game, { plank }) {
      const w = plank.angularVelocity * (1 - DAMPING) - SPRING * plank.angle;
      Matter.Body.setAngularVelocity(plank, w);
    },
    // Draw the bolt the plank pivots on.
    draw(ctx, { px, py }) {
      ctx.fillStyle = "#e8e8f0";
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
    },
  },

  {
    id: "sandbox",
    name: "Free Play",
    icon: "🧪",
    sandbox: true,
    goal: "No rules. Spawn shapes, build, throw and smash.",
    tip: "Use the + buttons below to add more shapes.",
    build(b) {
      b.wall(220, 420, 320, 14, { angle: 0.35, color: "#6b7089" }); // ramp
      b.wall(760, 360, 200, 14, { color: "#6b7089" });               // shelf
      for (let i = 0; i < 5; i++) b.block(560 + i * 70, onFloor(40), 60, 40);
      for (let i = 0; i < 3; i++) b.ball(120 + i * 60, 200, 22);
      b.block(760, 340 - 8, 180, 18);
    },
  },
];
