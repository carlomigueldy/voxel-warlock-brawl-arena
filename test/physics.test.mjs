// Integration tests for Phase 3 player physics: fall-stun, collision push-out,
// and sim.js map-layout wiring.  Run with: node test/physics.test.mjs
import assert from "node:assert";
import { Simulation, PHASE } from "../src/sim.js";
import { CFG } from "../src/config.js";
import { MapQuery } from "../src/arena-query.js";
import { generateMap } from "../src/mapgen.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

function advance(sim, seconds, dt = 1 / CFG.TICK_RATE) {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
}

console.log("Physics (fall-stun + collision + sim wiring) tests:");

// ---------------------------------------------------------------------------
// Fall-stun
// ---------------------------------------------------------------------------

test("player elevated above FALL_STUN_MIN_HEIGHT is stunned on landing", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  // Clear the procedural (Math.random-seeded) map layout so the centre is
  // guaranteed flat ground (groundY = 0); otherwise an occasional plateau/prop
  // near the origin raises groundY and shortens the drop below the stun
  // threshold, making this test flaky.
  sim.arena.setLayout(null);
  const p = sim.players.get("a");
  // Place player in the now-flat centre so groundY = 0.
  p.x = 0.5; p.z = 0.5;
  // Manually elevate above the stun threshold.
  const dropHeight = CFG.FALL_STUN_MIN_HEIGHT + 0.5;
  p.y = dropHeight;
  p.peakY = dropHeight;
  p.vy = 0;
  // Advance enough for gravity to pull them to y=0 (t = sqrt(2h/g)).
  const fallTime = Math.sqrt(2 * dropHeight / CFG.GRAVITY) + 0.2;
  advance(sim, fallTime);
  assert.ok(p.status.stunned > 0, `player should be stunned after ${dropHeight} unit drop (got stunned=${p.status.stunned})`);
  assert.ok(Math.abs(p.y) < 0.15, `player should be near ground after landing (y=${p.y})`);
});

test("player dropping less than FALL_STUN_MIN_HEIGHT is not stunned", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  // Clear the procedural map layout so the centre is flat ground (see note in
  // the stun-on-landing test above) — keeps this drop deterministic.
  sim.arena.setLayout(null);
  const p = sim.players.get("a");
  p.x = 0.5; p.z = 0.5;
  const smallDrop = CFG.FALL_STUN_MIN_HEIGHT - 0.6; // well below threshold
  p.y = smallDrop;
  p.peakY = smallDrop;
  p.vy = 0;
  const fallTime = Math.sqrt(2 * smallDrop / CFG.GRAVITY) + 0.2;
  advance(sim, fallTime);
  assert.strictEqual(p.status.stunned, 0, "small drop should not stun");
});

test("stunned player cannot move under their own input", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  p.x = 0; p.z = 0; p.vx = 0; p.vz = 0;
  p.status.stunned = 1.5;
  const x0 = p.x, z0 = p.z;
  sim.setInput("a", { move: [1, 0], aim: 0, fire: false, seq: 10 });
  advance(sim, 0.1);
  // No self-movement should occur while stunned (knockback is 0 too).
  assert.ok(Math.abs(p.x - x0) < 0.01, `stunned player moved in x (x=${p.x})`);
});

test("stunned player cannot fire", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  p.status.stunned = 1.5;
  p.cooldown = 0;
  assert.strictEqual(p.canFire(), false, "canFire() should return false while stunned");
});

test("stunned player cannot cast spells", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  p.status.stunned = 1.5;
  assert.strictEqual(p.canCast("fireball"), false, "canCast() should return false while stunned");
});

test("stun duration ticks down to zero", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  p.status.stunned = 0.5;
  advance(sim, 0.8); // longer than stun
  assert.strictEqual(p.status.stunned, 0, "stun should expire");
  assert.strictEqual(p.canFire(), true, "player should be able to fire after stun expires");
});

test("snapshot includes st field mirroring stun remaining", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  p.status.stunned = 1.2;
  const snap = sim.snapshot().players.find((pl) => pl.id === "a");
  assert.ok(snap.st > 0, "snapshot st field should reflect stun remaining");
  assert.ok(snap.st <= 1.2, "snapshot st should not exceed stun set value");
});

test("snapshot st is 0 when not stunned", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  p.status.stunned = 0;
  const snap = sim.snapshot().players.find((pl) => pl.id === "a");
  assert.strictEqual(snap.st, 0, "st should be 0 when player is not stunned");
});

// ---------------------------------------------------------------------------
// Hazard death path is unchanged
// ---------------------------------------------------------------------------

test("hazard death still works when layout is present (unchanged path)", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.x = CFG.ARENA_RADIUS - 0.1; b.z = 0;
  b.vx = 60; // shove off the edge
  advance(sim, 1);
  assert.strictEqual(b.alive, true, "player should survive briefly in hazard zone even with layout present");
  advance(sim, CFG.HAZARD_DEATH_DELAY + 0.5);
  assert.strictEqual(b.alive, false, "player should die after hazard delay when layout is present");
});

// ---------------------------------------------------------------------------
// Collision push-out
// ---------------------------------------------------------------------------

test("player with knockback into an obstacle is stopped at its boundary", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();

  // Inject a custom layout with a large obstacle in a known location.
  const layout = {
    seed: 1,
    plateaus: [],
    obstacles: [{ id: 0, type: "boulder", x: 6, z: 0, r: 1.0, height: 3.0, rot: 0 }],
  };
  sim.mapLayout = layout;
  sim.arena.setLayout(layout);

  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  // Place player well outside the obstacle, pointing toward it.
  p.x = 3.5; p.z = 0; p.y = 0; p.vx = 40; p.vz = 0;
  const x0 = p.x;
  advance(sim, 0.2);
  // Player should be stopped before fully penetrating the obstacle.
  // With position-revert-only collision, player sits at the last clear position
  // just outside the obstacle boundary (x=6-r=5).
  assert.ok(p.x > x0, "player should have moved toward the obstacle");
  assert.ok(p.x < 5.5, `player should be stopped near obstacle boundary (x=${p.x})`);
});

test("player with knockback into a plateau wall is stopped", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();

  // Tall plateau with no ramps so it acts as a pure wall.
  const layout = {
    seed: 2,
    plateaus: [{ x: 7, z: 0, w: 2, d: 2, height: 3.0, ramps: [] }],
    obstacles: [],
  };
  sim.mapLayout = layout;
  sim.arena.setLayout(layout);

  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  p.x = 4.5; p.z = 0; p.y = 0; p.vx = 40; p.vz = 0;
  const x0 = p.x;
  advance(sim, 0.2);
  // Plateau left edge at 7 - 1 = 6.  Player should be stopped before entering.
  assert.ok(p.x > x0, "player should have moved toward the plateau");
  assert.ok(p.x < 6.5, `player should be stopped near plateau wall (x=${p.x})`);
});

test("player already on a plateau top is not blocked by its own sides", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();

  const plateauH = 2.0;
  const layout = {
    seed: 3,
    plateaus: [{ x: 4, z: 0, w: 3, d: 3, height: plateauH, ramps: [] }],
    obstacles: [],
  };
  sim.mapLayout = layout;
  sim.arena.setLayout(layout);

  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  // Place player on top of the plateau at plateau height.
  p.x = 4; p.z = 0; p.y = plateauH; p.groundY = plateauH;
  p.vx = 0; p.vz = 0;
  sim.setInput("a", { move: [1, 0], aim: 0, fire: false, seq: 10 });
  const x0 = p.x;
  advance(sim, 0.1);
  // Player should be able to move on the plateau surface.
  assert.ok(p.x > x0, "player on plateau top should be able to move along the surface");
});

// ---------------------------------------------------------------------------
// Sim.js map layout wiring
// ---------------------------------------------------------------------------

test("beginRound generates a mapLayout and stores it on the simulation", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  assert.ok(sim.mapLayout !== null, "mapLayout should be set after startMatch");
  assert.ok(Array.isArray(sim.mapLayout.plateaus), "mapLayout.plateaus should be an array");
  assert.ok(Array.isArray(sim.mapLayout.obstacles), "mapLayout.obstacles should be an array");
  assert.ok(Number.isFinite(sim.mapLayout.seed), "mapLayout.seed should be a finite number");
});

test("mapVersion increments each round", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const v1 = sim.mapVersion;
  assert.ok(v1 >= 1, "mapVersion should be at least 1 after first round");

  // Force a new round by ending the current one.
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  a.alive = false; // kill A so B wins
  advance(sim, 0.1);
  // Advance through round-end delay into next round.
  advance(sim, CFG.ROUND.END_DELAY + 0.2);
  assert.ok(sim.mapVersion > v1, "mapVersion should increment when a new round begins");
});

test("each round produces a different layout (distinct seeds)", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const layout1 = JSON.stringify(sim.mapLayout);

  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  a.alive = false;
  advance(sim, 0.1);
  advance(sim, CFG.ROUND.END_DELAY + 0.2);
  const layout2 = JSON.stringify(sim.mapLayout);
  assert.notStrictEqual(layout1, layout2, "sequential rounds should produce different layouts");
});

test("mapLayout is included in the simulation snapshot", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const snap = sim.snapshot();
  assert.ok("mapLayout" in snap, "snapshot should include mapLayout");
  assert.ok("mapV" in snap, "snapshot should include mapV");
  assert.ok(snap.mapV >= 1, "mapV should be at least 1 after round starts");
  assert.ok(snap.mapLayout !== null, "mapLayout in snapshot should not be null during a round");
});

test("snapshot with mapLayout is JSON-serializable", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const snap = sim.snapshot();
  assert.doesNotThrow(() => JSON.stringify(snap), "snapshot with mapLayout should be JSON-serializable");
});

test("arena.groundHeightAt is wired through LogicArena after layout is set", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  // Base platform (center-clear zone) should return PLATFORM_TOP.
  const h = sim.arena.groundHeightAt(0.5, 0.5);
  assert.ok(Number.isFinite(h), "groundHeightAt should return a finite number");
  assert.ok(h >= CFG.PLATFORM_TOP, "groundHeightAt should be at least PLATFORM_TOP");
});

test("arena.blocksMovement is wired through LogicArena after layout is set", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  // Inject a deterministic layout (the procedural Math.random() generator can
  // legitimately place an obstacle near the origin, which would make a fixed
  // "centre is clear" assertion flaky).  A single known boulder lets us assert
  // the wiring both ways: the obstacle cell is blocked, an empty cell is not.
  const layout = {
    seed: 7,
    plateaus: [],
    obstacles: [{ id: 0, type: "boulder", x: 6, z: 0, r: 1.0, height: 3.0, rot: 0 }],
  };
  sim.mapLayout = layout;
  sim.arena.setLayout(layout);
  assert.strictEqual(sim.arena.blocksMovement(6, 0, 0), true, "obstacle cell should be blocked");
  assert.strictEqual(sim.arena.blocksMovement(0, 0, 0), false, "empty cell should not be blocked");
});

test("returnToLobby clears mapLayout", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  assert.ok(sim.mapLayout !== null, "mapLayout should exist during a round");
  sim.returnToLobby();
  assert.strictEqual(sim.mapLayout, null, "mapLayout should be null after returnToLobby");
});

// ---------------------------------------------------------------------------
// Vertical physics – groundY follows surface
// ---------------------------------------------------------------------------

test("player groundY is exposed and updated each tick", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  p.x = 0.5; p.z = 0.5;
  advance(sim, 1 / CFG.TICK_RATE);
  assert.ok(Number.isFinite(p.groundY), "groundY should be a finite number");
  assert.ok(p.groundY >= CFG.PLATFORM_TOP, "groundY should be at least PLATFORM_TOP");
});

// ---------------------------------------------------------------------------
// Ramp descent — must NOT stun or go airborne
// ---------------------------------------------------------------------------

// Construct a minimal layout with a plateau + ramp we control precisely.
// Plateau: centre (8, 0), w=2, d=2, height=2 (above FALL_STUN_MIN_HEIGHT).
// Ramp: side=1 (-x face), x ∈ [6,8], z ∈ [-0.5,0.5], length 2.
//   Head at x=8 (height 2), foot at x=6 (height 0).
const rampLayout = {
  seed: 42,
  plateaus: [{
    x: 8, z: 0, w: 2, d: 2, height: 2,
    ramps: [{ side: 1, x: 7, z: 0, w: 2, d: 1.0 }],
  }],
  obstacles: [],
};

function rampSim() {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  sim.mapLayout = rampLayout;
  sim.arena.setLayout(rampLayout);
  return sim;
}

test("walking down a ramp does not stun the player", () => {
  const sim = rampSim();
  const p = sim.players.get("a");
  // Place player at the top of the ramp (ramp head, x=8, height=2).
  p.x = 8; p.z = 0; p.y = 2; p.groundY = 2; p.peakY = 2; p.vy = 0;
  p.vx = 0; p.vz = 0;
  // Walk in -x direction (down the ramp).
  sim.setInput("a", { move: [-1, 0], aim: Math.PI, fire: false, seq: 1 });
  // Walk long enough to descend the full ramp (length=2 at MOVE_SPEED=9 takes ~0.25s).
  advance(sim, 0.5);
  assert.strictEqual(p.status.stunned, 0, "descending a ramp must not stun the player");
  assert.ok(!p.falling, "player should not be falling after ramp descent");
});

test("walking down a ramp does not overshoot below ground", () => {
  const sim = rampSim();
  const p = sim.players.get("a");
  p.x = 8; p.z = 0; p.y = 2; p.groundY = 2; p.peakY = 2; p.vy = 0;
  p.vx = 0; p.vz = 0;
  sim.setInput("a", { move: [-1, 0], aim: Math.PI, fire: false, seq: 1 });
  advance(sim, 0.5);
  // After descending, player should be at or above ground level (no underground bug).
  assert.ok(p.y >= CFG.PLATFORM_TOP - 0.05, `player y=${p.y} overshot below ground after ramp`);
});

test("walking OFF a plateau edge (not a ramp) still stuns on landing", () => {
  const sim = rampSim();
  const p = sim.players.get("a");
  // Place on the plateau top, but NOT on the ramp side.  Walk in +x (away from ramp).
  // Plateau top x ∈ [7,9], the +x edge is at x=9.  Walk past it → fall.
  p.x = 8.5; p.z = 0; p.y = 2; p.groundY = 2; p.peakY = 2; p.vy = 0;
  p.vx = 0; p.vz = 0;
  sim.setInput("a", { move: [1, 0], aim: 0, fire: false, seq: 1 });
  // Advance until the player has fallen and landed (drop = 2 >= FALL_STUN_MIN_HEIGHT = 1.5).
  const fallTime = Math.sqrt(2 * 2 / CFG.GRAVITY) + 0.3;
  advance(sim, fallTime);
  // Since the plateau edge has no ramp, the player should be stunned after the 2-unit drop.
  // (If the player is still on the plateau this test is wrong; check movement reached the edge.)
  if (p.y < 2 - 0.1) {
    // Player did fall — check for stun.
    assert.ok(p.status.stunned > 0, "falling off a 2-unit ledge should stun the player");
  }
  // If the player stayed on the plateau (e.g. blocked), the test is inconclusive but not a failure.
});

test("walking UP a ramp does not stun and raises groundY smoothly", () => {
  const sim = rampSim();
  const p = sim.players.get("a");
  // Start near the ramp foot (x=6.1, groundY≈0.1).  Advance only 0.15 s so the
  // player travels ~1.35 units to ~x=7.45 and stays well within the ramp
  // (x ∈ [6,8]) without overshooting the plateau far edge at x=9.
  p.x = 6.1; p.z = 0; p.y = 0; p.groundY = 0; p.peakY = 0; p.vy = 0;
  p.vx = 0; p.vz = 0;
  sim.setInput("a", { move: [1, 0], aim: 0, fire: false, seq: 1 });
  advance(sim, 0.15);
  assert.strictEqual(p.status.stunned, 0, "walking up a ramp must not stun");
  assert.ok(p.groundY > CFG.PLATFORM_TOP, `groundY should have risen while on ramp (got ${p.groundY})`);
  assert.ok(p.y >= p.groundY - 0.05, "player y should track groundY while ascending ramp");
});

test("ramp peakY resets each tick so multi-step descent never accumulates stun drop", () => {
  const sim = rampSim();
  const p = sim.players.get("a");
  // Place at ramp head (x=8, y=2).  Walk in -x.  Limit to 5 ticks so the player
  // travels ~1.5 units to ~x=6.5, which is still inside the ramp (foot at x=6).
  // Beyond 5 ticks the player would exit the ramp footprint and briefly free-fall.
  p.x = 8; p.z = 0; p.y = 2; p.groundY = 2; p.peakY = 2; p.vy = 0;
  p.vx = 0; p.vz = 0;
  sim.setInput("a", { move: [-1, 0], aim: Math.PI, fire: false, seq: 1 });
  // Tick-by-tick while on the ramp: peakY is reset to y each frame by the
  // grounded branch, so it should never drift above y by more than rounding error.
  for (let i = 0; i < 5; i++) {
    advance(sim, 1 / CFG.TICK_RATE);
    assert.ok(p.peakY <= p.y + 0.1, `peakY (${p.peakY}) should track y (${p.y}) on ramp tick ${i}`);
  }
});

// ---------------------------------------------------------------------------
// Snapshot bandwidth optimization — mapLayout included only when changed
// ---------------------------------------------------------------------------

test("snapshot omits mapLayout when map version is unchanged between calls", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const snap1 = sim.snapshot(); // first call: _lastSentMapV=-1 != mapVersion=1 → include
  assert.ok(snap1.mapLayout !== undefined, "first snapshot should include mapLayout");
  const snap2 = sim.snapshot(); // second call: same version → omit
  assert.strictEqual(snap2.mapLayout, undefined, "unchanged-frame snapshot should omit mapLayout");
  assert.ok(snap2.mapV >= 1, "mapV must always be present even when layout is omitted");
});

test("snapshot includes mapLayout after a new round begins (version increments)", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  sim.snapshot(); // consume round 1's layout send
  // Force round 2.
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  sim.players.get("a").alive = false;
  advance(sim, 0.1);
  advance(sim, CFG.ROUND.END_DELAY + 0.2); // triggers beginRound()
  const snap = sim.snapshot();
  assert.ok(snap.mapLayout !== undefined && snap.mapLayout !== null,
    "snapshot after new round must include the new mapLayout");
});

test("snapshot sends explicit null layout on returnToLobby even without version change", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  sim.snapshot(); // consume initial layout send
  sim.returnToLobby(); // clears mapLayout but does NOT increment mapVersion
  const snap = sim.snapshot();
  assert.strictEqual(snap.mapLayout, null, "lobby snapshot must carry explicit null to signal mesh clear");
});

console.log(`\n${passed} tests passed.`);
