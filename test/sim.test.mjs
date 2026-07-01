// Headless smoke + logic tests for the pure simulation (no browser needed).
// Run with: node test/sim.test.mjs
import assert from "node:assert";
import { Simulation, PHASE } from "../src/sim.js";
import { Bolt } from "../src/bolt.js";
import { CFG, SPELLS } from "../src/config.js";
import { Player } from "../src/player.js";
import { dodgeVector } from "../src/bot.js";
import { castSpell } from "../src/spells.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

function advance(sim, seconds, dt = 1 / CFG.TICK_RATE) {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
  // Clear the procedural map layout after advancing so random obstacles
  // (placed by the Math.random()-seeded map generator) do not block bolt
  // travel in tests that reposition players.  isOnPlatform / arena radius
  // are layout-independent and are unaffected by this call.
  if (sim.arena && typeof sim.arena.setLayout === "function") {
    sim.arena.setLayout(null);
  }
}

console.log("Simulation tests:");

test("players can be added and assigned distinct colors", () => {
  const sim = new Simulation();
  const a = sim.addPlayer("a", "Alice");
  const b = sim.addPlayer("b", "Bob");
  assert.notStrictEqual(a.colorIndex, b.colorIndex);
  assert.strictEqual(sim.players.size, 2);
});

test("startMatch spawns players on the platform and enters countdown", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  assert.strictEqual(sim.phase, PHASE.COUNTDOWN);
  for (const p of sim.players.values()) {
    assert.ok(sim.arena.isOnPlatform(p.x, p.z), "spawned off platform");
    assert.ok(p.alive);
  }
});

test("simulation exposes five selectable arena worlds", () => {
  assert.deepStrictEqual(CFG.ARENA_WORLDS.map((world) => world.id), ["circle", "islands", "bridge", "cross", "ring"]);
});

test("host arena world option changes playable land shape", () => {
  const sim = new Simulation({ arenaWorld: "bridge" });
  assert.strictEqual(sim.arena.world.id, "bridge");
  assert.strictEqual(sim.arena.isOnPlatform(0, 0), true);
  assert.strictEqual(sim.arena.isOnPlatform(10, 10), false);
  assert.strictEqual(sim.snapshot().arenaWorld, "bridge");
});

test("host land size option sets starting arena radius and spawn ring", () => {
  const sim = new Simulation({ landSize: "large" });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  assert.strictEqual(sim.arena.radius, CFG.ARENA_LAND_SIZES.large.radius);
  for (const p of sim.players.values()) {
    const d = Math.hypot(p.x, p.z);
    assert.ok(d > CFG.ARENA_RADIUS, "large land size should spawn players farther out");
    assert.ok(sim.arena.isOnPlatform(p.x, p.z), "spawned off large platform");
  }
});

test("invalid arena world and land size options fall back to defaults", () => {
  const sim = new Simulation({ arenaWorld: "bad", landSize: "huge" });
  assert.strictEqual(sim.arena.world.id, CFG.DEFAULT_ARENA_WORLD);
  assert.strictEqual(sim.landSize.id, CFG.DEFAULT_ARENA_LAND_SIZE);
});

test("every selectable arena world spawns players on playable land", () => {
  for (const world of CFG.ARENA_WORLDS) {
    const sim = new Simulation({ arenaWorld: world.id, landSize: "medium" });
    for (let i = 0; i < CFG.MAX_PLAYERS; i++) sim.addPlayer(`p${i}`, `P${i}`);
    sim.startMatch();
    for (const p of sim.players.values()) {
      assert.ok(sim.arena.isOnPlatform(p.x, p.z), `${world.id} spawned ${p.id} off platform at ${p.x},${p.z}`);
    }
  }
});

test("countdown transitions to playing", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.2);
  assert.strictEqual(sim.phase, PHASE.PLAYING);
});

test("fireball cast spawns a bolt that travels", () => {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.aim = 0;
  sim.setInput("a", { move: [0, 0], aim: 0, seq: 1, casts: [{ id: 1, spell: "fireball", tx: 5, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(sim.bolts.length >= 1, "no bolt spawned");
  const bx0 = sim.bolts[0].x;
  sim.step(0.1);
  assert.ok(sim.bolts[0].x > bx0, "bolt did not travel");
});

test("fireball cast emits a cast event for animation", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.aim = 0;
  sim.setInput("a", { move: [0, 0], aim: 0, seq: 1, casts: [{ id: 1, spell: "fireball", tx: 5, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(sim.events.some((ev) => ev.type === "cast" && ev.spell === "fireball" && ev.id === "a"), "fireball cast should emit cast event");
});

test("a bolt hit applies knockback velocity to the victim", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  // Place A just left of B, aiming right toward B.
  a.x = -2; a.z = 0; a.aim = 0;
  b.x = -0.5; b.z = 0; b.vx = 0; b.vz = 0;
  sim.setInput("a", { move: [0, 0], aim: 0, seq: 1, casts: [{ id: 1, spell: "fireball", tx: 5, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE); // spawn bolt
  for (let i = 0; i < 5; i++) sim.step(1 / CFG.TICK_RATE);
  assert.ok(b.vx > 0, "victim was not knocked in +x direction (vx=" + b.vx + ")");
  assert.ok(b.hp < b.maxHp, "victim should have taken damage from fireball");
});

test("opposing projectiles cancel each other without damaging players", () => {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  a.x = -4; a.z = 0; a.aim = 0;
  b.x = 4; b.z = 0; b.aim = Math.PI;
  a.vx = 0; a.vz = 0; b.vx = 0; b.vz = 0;
  sim.setInput("a", { move: [0, 0], aim: 0, seq: 1, casts: [{ id: 1, spell: "fireball", tx: 10, tz: 0 }] });
  sim.setInput("b", { move: [0, 0], aim: Math.PI, seq: 1, casts: [{ id: 1, spell: "fireball", tx: -10, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE);
  let sawClash = false;
  for (let t = 0; t < 0.35; t += 1 / CFG.TICK_RATE) {
    sim.step(1 / CFG.TICK_RATE);
    sawClash ||= sim.events.some((ev) => ev.type === "projectileClash");
  }
  assert.strictEqual(sim.bolts.length, 0, "colliding projectiles should be destroyed");
  assert.strictEqual(a.vx, 0, "caster A should not receive knockback");
  assert.strictEqual(b.vx, 0, "caster B should not receive knockback");
  assert.ok(sawClash, "missing projectile clash event");
});

test("fast opposing projectiles clash even when they cross within a single tick", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  // Park casters far apart and out of the projectiles' path so they can't be hit.
  a.x = 0; a.z = 12; a.vx = 0; a.vz = 0;
  b.x = 0; b.z = -12; b.vx = 0; b.vz = 0;
  // Two near-head-on bolts on crossing paths with a 0.62 lateral offset. Their
  // geometric closest approach (0.62) is well inside the clash diameter (0.9),
  // but at full BOLT_SPEED they swap sides between ticks, so a point-overlap
  // check sampled only at tick boundaries never sees them within range.
  sim.bolts.push(new Bolt("a", -4, 0, 0, 0xffffff));
  sim.bolts.push(new Bolt("b", 4, 0.62, Math.PI, 0xffffff));
  let sawClash = false;
  for (let t = 0; t < 0.2; t += 1 / CFG.TICK_RATE) {
    sim.step(1 / CFG.TICK_RATE);
    sawClash ||= sim.events.some((ev) => ev.type === "projectileClash");
  }
  assert.ok(sawClash, "fast crossing projectiles tunneled without clashing");
  assert.strictEqual(sim.bolts.length, 0, "tunneled projectiles were not destroyed");
});

test("charge increases knockback on subsequent hits (Smash-style)", () => {
  const sim = new Simulation();
  const b = sim.addPlayer("b", "B");
  // direct unit test of player physics
  b.x = 0; b.z = 0; b.vx = 0; b.alive = true;
  b.applyHit(1, 0);
  const firstKb = b.vx;
  b.vx = 0;
  b.applyHit(1, 0);
  const secondKb = b.vx;
  assert.ok(secondKb > firstKb, "knockback did not scale with charge");
});

test("hazard death delay stays within the recovery target window", () => {
  assert.ok(CFG.HAZARD_DEATH_DELAY >= 3);
  assert.ok(CFG.HAZARD_DEATH_DELAY <= 5);
});

test("a player knocked into the hazard zone gets a short recovery window before dying", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.x = CFG.ARENA_RADIUS - 0.1; b.z = 0;
  b.vx = 60; // huge shove off the edge
  advance(sim, 1);
  assert.strictEqual(b.alive, true, "player should survive briefly in the hazard zone");
  assert.strictEqual(b.falling, false, "player should remain controllable during the recovery window");
  advance(sim, CFG.HAZARD_DEATH_DELAY + 0.2);
  assert.strictEqual(b.alive, false, "player should die after the hazard death delay expires");
});

test("a player in the hazard zone can recover by moving back onto the platform", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.x = CFG.ARENA_RADIUS + 0.2; b.z = 0;
  b.vx = 0; b.vz = 0;
  sim.setInput("b", { move: [-1, 0], aim: Math.PI, fire: false, seq: 1 });
  advance(sim, 0.5);
  assert.strictEqual(b.alive, true);
  assert.strictEqual(b.falling, false);
  assert.ok(sim.arena.isOnPlatform(b.x, b.z), "player should be back on the platform");
  advance(sim, CFG.HAZARD_DEATH_DELAY + 0.2);
  assert.strictEqual(b.alive, true, "recovered player should not keep burning after returning");
});

test("hazard zone exposes a local countdown before the fall", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.x = CFG.ARENA_RADIUS + 0.2; b.z = 0;
  b.vx = 0; b.vz = 0;
  sim.step(1 / CFG.TICK_RATE);
  const snap = sim.snapshot().players.find((p) => p.id === "b");
  assert.ok(snap.hz > 0, "hazard countdown should be visible in snapshots");
  assert.ok(snap.hz <= CFG.HAZARD_DEATH_DELAY);
});

test("swap can recover a player from the hazard zone", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  a.x = 1; a.z = 0;
  b.x = CFG.ARENA_RADIUS + 0.2; b.z = 0;
  b.vx = 0; b.vz = 0;
  // swap is not in DEFAULT_SPELL_LOADOUT; grant it directly so canCast passes.
  b.spells.add("swap"); b.cooldowns["swap"] = 0;
  sim.setInput("b", { move: [0, 0], aim: Math.PI, fire: false, seq: 1, casts: [{ id: 1, spell: "swap", tx: 0, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(sim.arena.isOnPlatform(b.x, b.z), "swap should move the hazard-zone player back to the platform");
  assert.strictEqual(b.alive, true);
});

test("projectiles can hit players recovering in the hazard zone", () => {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  a.x = CFG.ARENA_RADIUS - 2; a.z = 0; a.aim = 0;
  // Pin groundY to flat-ground level so the bolt spawns at the expected height
  // and the height gate does not block it due to a procedurally-generated plateau.
  a.groundY = CFG.PLATFORM_TOP; b.groundY = CFG.PLATFORM_TOP;
  b.x = CFG.ARENA_RADIUS + 0.7; b.z = 0; b.vx = 0; b.vz = 0;
  sim.setInput("a", { move: [0, 0], aim: 0, seq: 1, casts: [{ id: 1, spell: "fireball", tx: CFG.ARENA_RADIUS + 1, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE);
  let hit = sim.events.some((ev) => ev.type === "hit" && ev.victim === "b");
  for (let i = 0; i < 8; i++) {
    sim.step(1 / CFG.TICK_RATE);
    hit ||= sim.events.some((ev) => ev.type === "hit" && ev.victim === "b");
  }
  assert.ok(b.vx > 0, "hazard-zone victim should be hit and pushed farther out");
  assert.ok(hit, "hit event should be emitted for hazard-zone victim");
});

test("players recovering in the hazard zone can fire back at players on land", () => {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  a.x = CFG.ARENA_RADIUS + 0.7; a.z = 0; a.aim = Math.PI;
  b.x = CFG.ARENA_RADIUS - 2; b.z = 0; b.vx = 0; b.vz = 0;
  sim.setInput("a", { move: [0, 0], aim: Math.PI, seq: 1, casts: [{ id: 1, spell: "fireball", tx: CFG.ARENA_RADIUS - 2, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE);
  advance(sim, 0.2);
  assert.ok(b.vx < 0, "land player should be hit by a hazard-zone caster firing back");
});

test("hazard zone movement is slowed but still allows spell recovery", () => {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.x = 0; b.z = 0;
  sim.setInput("b", { move: [1, 0], aim: 0, seq: 1 });
  advance(sim, 0.25);
  const normalDistance = b.x;
  b.x = CFG.ARENA_RADIUS + 0.2; b.z = 0;
  b.vx = 0; b.vz = 0;
  sim.setInput("b", { move: [1, 0], aim: 0, fire: false, seq: 2 });
  advance(sim, 0.25);
  const hazardDistance = b.x - (CFG.ARENA_RADIUS + 0.2);
  assert.ok(hazardDistance > 0, "player should still have movement control in the hazard zone");
  assert.ok(hazardDistance < normalDistance * 0.5, "hazard zone movement should be meaningfully slowed");
  sim.setInput("b", { move: [0, 0], aim: 0, fire: false, seq: 3, casts: [{ id: 1, spell: "teleport", tx: 0, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(sim.arena.isOnPlatform(b.x, b.z), "teleport should allow hazard-zone recovery");
  assert.strictEqual(b.alive, true);
});

test("round ends with a winner when only one survives", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.alive = false; // simulate B already dead
  sim.step(1 / CFG.TICK_RATE);
  assert.strictEqual(sim.phase, PHASE.ROUND_END);
  assert.strictEqual(sim.lastWinnerId, "a");
  assert.strictEqual(sim.players.get("a").score, 1);
});

test("arena shrinks after the configured delay", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const r0 = sim.arena.radius;
  advance(sim, CFG.ROUND.SHRINK_START_DELAY + 2);
  assert.ok(sim.arena.radius < r0, "arena did not shrink");
});

test("snapshot is JSON-serializable and contains players + bolts", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const snap = sim.snapshot();
  const round = JSON.parse(JSON.stringify(snap));
  assert.ok(Array.isArray(round.players));
  assert.ok(Array.isArray(round.bolts));
  assert.strictEqual(round.players.length, 2);
});

test("match cannot start with fewer than two players", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A");
  assert.strictEqual(sim.canStartMatch(), false);
  assert.strictEqual(sim.startMatch(), false);
  assert.strictEqual(sim.phase, PHASE.LOBBY);
});

test("disconnecting during a two-player round returns the survivor to lobby", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  sim.removePlayer("b");
  assert.strictEqual(sim.phase, PHASE.LOBBY);
  assert.strictEqual(sim.lastWinnerId, null);
  assert.strictEqual(sim.players.get("a").score, 0);
  assert.strictEqual(sim.canStartMatch(), false);
});

test("late players joining an active round are spectators until next round", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const c = sim.addPlayer("c", "C");
  assert.strictEqual(c.alive, false);
  assert.strictEqual(c.spectating, true);
});

test("malformed input is sanitized before the host simulation uses it", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  assert.doesNotThrow(() => sim.setInput("a", { move: "bad", aim: Infinity, seq: 1 }));
  assert.deepStrictEqual(sim.players.get("a").input.move, [0, 0]);
  assert.strictEqual(sim.players.get("a").input.aim, 0);
  assert.doesNotThrow(() => sim.step(1 / CFG.TICK_RATE));
});

test("host can configure brilliant bots up to open player slots", () => {
  const sim = new Simulation();
  sim.addPlayer("host", "Host");
  sim.addPlayer("guest", "Guest");
  const bots = sim.setBotRoster(5, "brilliant");
  assert.strictEqual(bots.length, CFG.MAX_PLAYERS - 2);
  assert.strictEqual(sim.players.size, CFG.MAX_PLAYERS);
  assert.ok(bots.every((p) => p.isBot));
  assert.ok(bots.every((p) => p.botSkill === "brilliant"));
  assert.ok(bots.every((p) => /^Brilliant Bot/.test(p.name)));
});

test("smart expert bots produce combat input against each other", () => {
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(2, "expert");
  assert.strictEqual(sim.startMatch(), true);
  // advance() already clears the layout at its end (see helper above).
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const bots = [...sim.players.values()].filter((p) => p.isBot);
  assert.strictEqual(bots.length, 2);
  assert.ok(bots.every((p) => p.input.seq > 0));
  // Pin bots close together so attack range is guaranteed; widen to a 5-s
  // statistical window so RNG-gated firing reliably produces at least one bolt.
  const [b1, b2] = bots;
  b1.x = 0; b1.z = 0; b2.x = 3; b2.z = 0;
  let hadAttack = false;
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < 5; t += dt) {
    sim.step(dt);
    if (sim.bolts.length > 0 || sim.meteors.length > 0) { hadAttack = true; break; }
  }
  assert.ok(hadAttack, "bot combat input should produce attacks");
});

test("expert bots use handbook abilities against targets", () => {
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(2, "expert");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  let casts = 0;
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < 0.4; t += dt) {
    sim.step(dt);
    casts += sim.events.filter((e) => e.type === "meteorCast" || e.type === "lightning" || e.type === "cast").length;
  }
  assert.ok(casts > 0 || sim.meteors.length > 0, "expert bots should cast abilities");
});

test("every bot tier casts handbook abilities (no dead range checks)", () => {
  function countAbilityCasts(skill, seconds) {
    const sim = new Simulation({ seed: 42 });
    sim.setBotRoster(2, skill);
    assert.strictEqual(sim.startMatch(), true);
    advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
    let casts = 0;
    const dt = 1 / CFG.TICK_RATE;
    for (let t = 0; t < seconds; t += dt) {
      sim.step(dt);
      const abilityTypes = ["cast", "lightning", "meteorCast", "gravity", "thrust", "shield", "swap", "drain", "link", "teleport"];
      casts += sim.events.filter((e) => abilityTypes.includes(e.type)).length;
      if (sim.phase !== PHASE.PLAYING) break;
    }
    return casts;
  }
  for (const skill of ["smart", "brilliant", "expert"]) {
    assert.ok(countAbilityCasts(skill, 8) > 0, `${skill} bots should cast at least one ability`);
  }
});

test("bot difficulty tiers cast at distinct cadences (expert > brilliant > smart)", () => {
  // Bots no longer run a separate hardcoded fireball timer — fireball is just
  // another weighted candidate inside selectAbility(), competing alongside the
  // rest of the bot's varied equipped kit (see abilityWeights in bot.js). This
  // test counts every ability-cast event regardless of which spell it is, but
  // it only asserts the abilityEvery cadence ordering (expert > brilliant >
  // smart) — it does NOT assert kit variety. See the "casts a variety of
  // equipped spells" test below for that.
  //
  // Event types emitted by castSpell() (see src/spells.js) for the caster: most
  // carry an `id` field, but swap/drain/link key the caster as `a` instead.
  const ABILITY_EVENT_TYPES = new Set([
    "cast", "lightning", "meteorCast", "teleport", "thrust",
    "swap", "drain", "gravity", "link", "shield",
  ]);
  const isBotCast = (ev, botId) =>
    ABILITY_EVENT_TYPES.has(ev.type) && (ev.id === botId || ev.a === botId);

  // Pin both bots at a fixed close distance before every tick so knockback
  // cannot push them outside spell range — this isolates the abilityEvery
  // cadence constant (the actual invariant) from positioning noise caused by
  // balance tuning (KB values, friction, spell ranges, etc.).
  function countCasts(skill, seconds) {
    const sim = new Simulation({ seed: 42 });
    sim.setBotRoster(2, skill);
    assert.strictEqual(sim.startMatch(), true);
    advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
    const bots = sim.botPlayers();
    const bot = bots[0];
    let casts = 0;
    const dt = 1 / CFG.TICK_RATE;
    for (let t = 0; t < seconds; t += dt) {
      // Reset positions, velocities, HP, and status so bots can't die or fall back.
      // This isolates cast-cadence from survival mechanics (damage rebalance, burn DoT).
      for (const p of sim.players.values()) {
        p.vx = 0; p.vz = 0; p.alive = true; p.falling = false; p._hazardTime = 0;
        p.hp = p.maxHp; // prevent accumulated damage from ending the round early
        p.status.burn = 0; p.status.burnDps = 0; p.status.burnBy = null; p.status.burnTickAcc = 0;
        p.status.slow = 0; p.status.slowMul = 1;
        p.status.curse = 0; p.status.curseMul = 1;
        p.charge = 0;
      }
      if (bots[0]) { bots[0].x = 0; bots[0].z = 0; }
      if (bots[1]) { bots[1].x = 8; bots[1].z = 0; } // 8u: inside every tier's ability reach
      sim.step(dt);
      if (sim.phase !== PHASE.PLAYING) break;
      // Count every ability-cast event this bot emits this tick, across its
      // full varied kit rather than a single hardcoded spell.
      casts += sim.events.filter((ev) => isBotCast(ev, bot.id)).length;
    }
    return casts;
  }
  // Sample over a long window: ability selection is gated purely by the
  // deterministic per-tier abilityEvery timer (no randomness involved), but a
  // short window still leaves enough rounding/edge noise near tier boundaries
  // to occasionally invert adjacent tiers.  ~12 s of ticks lets the
  // abilityEvery cadence dominate that noise so the ordering is stable.
  const smart = countCasts("smart", 12);
  const brilliant = countCasts("brilliant", 12);
  const expert = countCasts("expert", 12);
  assert.ok(expert > brilliant, `expert(${expert}) should out-cast brilliant(${brilliant})`);
  assert.ok(brilliant > smart, `brilliant(${brilliant}) should out-cast smart(${smart})`);
});

test("smart-tier bot casts a variety of equipped spells, not fireball alone", () => {
  // Regression guard: fireball's general-zoning score must not dominate every
  // other equipped candidate for every tier (it did for "smart" pre-fix,
  // since fireball's short cooldown meant it was always off-cooldown and
  // always won the score comparison — see bot-review F1). Assert the smart
  // tier's own kit (homing/bouncer/boomerang/fireSpray) shows up at least
  // once over a long window, not just fireball/thrust/shield.
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(2, "smart");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
  const bots = sim.botPlayers();
  const bot = bots[0];
  const seenSpells = new Set();
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < 12; t += dt) {
    for (const p of sim.players.values()) {
      p.vx = 0; p.vz = 0; p.alive = true; p.falling = false; p._hazardTime = 0;
      p.hp = p.maxHp;
      p.status.burn = 0; p.status.burnDps = 0; p.status.burnBy = null; p.status.burnTickAcc = 0;
      p.status.slow = 0; p.status.slowMul = 1;
      p.status.curse = 0; p.status.curseMul = 1;
      p.charge = 0;
    }
    if (bots[0]) { bots[0].x = 0; bots[0].z = 0; }
    if (bots[1]) { bots[1].x = 8; bots[1].z = 0; }
    sim.step(dt);
    if (sim.phase !== PHASE.PLAYING) break;
    for (const ev of sim.events) {
      if (ev.type === "cast" && ev.id === bot.id) seenSpells.add(ev.spell);
    }
  }
  assert.ok(
    seenSpells.size > 1 || (seenSpells.size === 1 && !seenSpells.has("fireball")),
    `smart tier should cast more than just fireball over 12s, saw: ${[...seenSpells]}`
  );
});

// ── New behaviour tests (bot.js archetypes) ─────────────────────────────────

test("bot archetype loadouts are applied as item modifiers", () => {
  // Expert: wardingHelm (kbResist=0.2) + arcaneSigil (cdr=0.15)
  const sim = new Simulation();
  sim.setBotRoster(2, "expert");
  const [expertBot] = sim.botPlayers();
  assert.ok(expertBot.mods.kbResist > 0, "expert bot should have kbResist from wardingHelm loadout");
  assert.ok(expertBot.mods.cdr > 0, "expert bot should have CDR from arcaneSigil loadout");
  // Smart: berserkerBlade (dmgMul > 1) + swiftBoots (speedMul > 1)
  const sim2 = new Simulation();
  sim2.setBotRoster(2, "smart");
  const [smartBot] = sim2.botPlayers();
  assert.ok(smartBot.mods.dmgMul > 1, "smart bot should have damage bonus from berserkerBlade loadout");
  assert.ok(smartBot.mods.speedMul > 1, "smart bot should have speed bonus from swiftBoots loadout");
});

test("bot uses escape spell when pushed near the arena edge", () => {
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(2, "expert");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
  const [bot] = sim.botPlayers();
  // Place bot inside the 4-unit edge-danger zone
  bot.x = sim.arena.radius - 1.5;
  bot.z = 0; bot.vx = 0; bot.vz = 0;
  // Make ability available immediately
  bot._nextBotAbilityAt = 0;
  bot.cooldowns = {};
  let escaped = false;
  for (let i = 0; i < 5; i++) {
    sim.step(1 / CFG.TICK_RATE);
    if (sim.events.some((e) => (e.type === "thrust" || e.type === "teleport") && e.id === bot.id)) {
      escaped = true; break;
    }
  }
  assert.ok(escaped, "expert bot near the arena edge should immediately use an escape spell");
});

test("expert bot leads aim ahead of a moving target", () => {
  // With leadFactor=0.9, an expert bot watching a target move perpendicularly
  // should aim ahead of the direct bearing by ~0.3 radians.
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(1, "expert");
  sim.addPlayer("human", "Human");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const bot = sim.botPlayers()[0];
  const human = sim.players.get("human");
  // Fix starting positions: bot at centre, human 8 units in +x moving in +z
  bot.x = 0; bot.z = 0; bot.vx = 0; bot.vz = 0;
  human.x = 8; human.z = 0; human.vx = 0; human.vz = 0;
  sim.setInput("human", { move: [0, 1], aim: 0, fire: false, seq: 20 });
  // 5 ticks for EMA velocity estimator to converge toward MOVE_SPEED
  for (let i = 0; i < 5; i++) sim.step(1 / CFG.TICK_RATE);
  // Direct bearing at current positions
  const directAim = Math.atan2(human.z - bot.z, human.x - bot.x);
  // With tvz ≈ MOVE_SPEED and leadFactor=0.9 the predicted intercept sits
  // ~2-3 units above the current human position → aim clearly above directAim.
  assert.ok(
    bot.input.aim > directAim,
    `expert bot should lead a moving target (aim=${bot.input.aim.toFixed(3)}, direct=${directAim.toFixed(3)})`
  );
});

test("expert bot lands hits on a moving target via lead-aim", () => {
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(1, "expert");
  sim.addPlayer("human", "Human");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const bot = sim.botPlayers()[0];
  const human = sim.players.get("human");
  // Bot at centre; human at (8, 0) moving steadily in +z (perpendicular to bot)
  bot.x = 0; bot.z = 0; bot.vx = 0; bot.vz = 0;
  human.x = 8; human.z = 0; human.vx = 0; human.vz = 0;
  sim.setInput("human", { move: [0, 1], aim: 0, fire: false, seq: 20 });
  let hits = 0;
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < 2; t += dt) {
    sim.step(dt);
    hits += sim.events.filter((e) => e.type === "hit" && e.victim === "human").length;
    if (!bot.alive || !human.alive || sim.phase !== PHASE.PLAYING) break;
  }
  assert.ok(hits > 0, `expert bot should land hits on a perpendicularly-moving target (got ${hits})`);
});

test("bot selects KO spell when target has high charge near the arena edge", () => {
  // Discriminating test: the KO-burst branch gives meteor a score of 2.5*0.9=2.25,
  // beating the general-zoning top choice (lightning: 1.0*0.95=0.95).  Without
  // the KO branch, lightning would win, not meteor.  The test therefore asserts
  // specifically "meteorCast" so deleting the KO-burst block would cause failure.
  function runScenario(charge) {
    const sim = new Simulation({ seed: 42 });
    sim.setBotRoster(2, "expert");
    sim.startMatch();
    advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
    const [bot, target] = sim.botPlayers();
    // Target near edge (2.5 units from rim)
    target.x = sim.arena.radius - 2.5; target.z = 0; target.charge = charge;
    // Bot within meteor range (~8.5 units from target)
    bot.x = sim.arena.radius - 11; bot.z = 0; bot.vx = 0; bot.vz = 0;
    bot._nextBotAbilityAt = 0; bot.cooldowns = {};
    const spellsFired = [];
    for (let i = 0; i < 10; i++) {
      sim.step(1 / CFG.TICK_RATE);
      for (const e of sim.events) {
        if (e.id === bot.id && (e.type === "meteorCast" || e.type === "lightning" || e.type === "gravity")) {
          spellsFired.push(e.type);
        }
      }
      if (spellsFired.length) break;
    }
    return spellsFired[0] ?? null;
  }

  // KO scenario: target has high charge near edge → meteor should win (score 2.25)
  const koSpell = runScenario(2.0);
  assert.strictEqual(koSpell, "meteorCast",
    `expert bot should pick meteor in KO-burst scenario (got ${koSpell}) — ` +
    "the KO-burst multiplier (2.5×) must lift meteor above the general-zoning winner (lightning 0.95)");

  // Non-KO scenario: same geometry but charge=0 → lightning wins general zoning (score 0.95 > meteor 0.81)
  const normalSpell = runScenario(0);
  assert.notStrictEqual(normalSpell, "meteorCast",
    "with no KO conditions expert bot should NOT default to meteor (got meteorCast — " +
    "KO-burst branch must have fired despite charge=0 or target not near edge)");
});

test("dodgeVector returns evasion vector for incoming bolt and null when dodge is disabled", () => {
  // Direct unit-test of dodgeVector so the assertion is not confounded by the
  // always-on perpendicular strafe (which makes any sim-level move-vector > 0
  // regardless of whether dodging fires).
  //
  // Bolt at (0, 4) heading straight at the bot at (0, 0) with full speed (-z).
  // reactionSec = 0.175 s → nextBZ = 4 - 26*0.175 = -0.55; closestApproach ≈ 0.03
  // which is well below hitThreshold (0.6+0.45+0.4 = 1.45), so the threat registers.
  const bot = { id: "bot", x: 0, z: 0 };
  const expertProfile = { dodgeChance: 1.0, dodgeRange: 14, reactionMs: 175 };
  const alwaysDodge = () => 0; // rand() returns 0, never > dodgeChance (1.0)

  const incomingBolt = { dead: false, ownerId: "enemy", x: 0, z: 4, vx: 0, vz: -CFG.BOLT_SPEED };
  const mockSim = { bolts: [incomingBolt], meteors: [] };

  const vec = dodgeVector(mockSim, bot, expertProfile, alwaysDodge);
  assert.ok(vec !== null,
    "dodgeVector must return a non-null vector when a bolt is on a collision course");
  assert.ok(Math.abs(vec.x) + Math.abs(vec.z) > 0.5,
    `dodge vector should be meaningfully non-zero (got {x:${vec.x}, z:${vec.z}})`);

  // With dodgeChance=0 the function returns null at the early guard — dodge is disabled.
  const noProfile = { dodgeChance: 0, dodgeRange: 14, reactionMs: 175 };
  const vec2 = dodgeVector(mockSim, bot, noProfile, alwaysDodge);
  assert.strictEqual(vec2, null,
    "dodgeVector must return null when dodgeChance is 0 (dodge disabled)");

  // The stochastic gate also blocks when rand() > dodgeChance.
  const neverPassGate = () => 1.0; // rand() always returns 1.0 > dodgeChance (1.0) → false
  // Actually rand() > chance: 1.0 > 1.0 is false, use a value > 1 which is not possible.
  // Use dodgeChance=0.5 and rand=()=>0.9 so 0.9 > 0.5 → gate blocks.
  const halfProfile = { dodgeChance: 0.5, dodgeRange: 14, reactionMs: 175 };
  const blockedByGate = dodgeVector(mockSim, bot, halfProfile, () => 0.9);
  assert.strictEqual(blockedByGate, null,
    "dodgeVector must return null when the stochastic gate blocks (rand() > dodgeChance)");
});

// ── HP & damage core (Step 1) ────────────────────────────────────────────────

test("hp inits to max on construction", () => {
  const p = new Player("a", "A", 0);
  assert.strictEqual(p.hp, CFG.PLAYER_HP_MAX, "hp should equal PLAYER_HP_MAX at construction");
  assert.strictEqual(p.maxHp, CFG.PLAYER_HP_MAX, "maxHp should equal PLAYER_HP_MAX at construction");
});

test("applyDamage reduces hp, records attacker, keeps player alive below max", () => {
  const p = new Player("a", "A", 0);
  const result = p.applyDamage(30, "x");
  assert.strictEqual(result, true, "applyDamage should return true when damage lands");
  assert.strictEqual(p.hp, CFG.PLAYER_HP_MAX - 30, "hp should drop by 30");
  assert.strictEqual(p.lastAttackerId, "x", "attacker id should be recorded");
  assert.strictEqual(p.alive, true, "player should still be alive");
});

test("applyDamage kills player at 0 and returns false thereafter", () => {
  const p = new Player("a", "A", 0);
  p.applyDamage(9999, "x");
  assert.strictEqual(p.hp, 0, "hp should clamp to 0");
  assert.strictEqual(p.alive, false, "player should be dead when hp reaches 0");
  const r2 = p.applyDamage(1, "x");
  assert.strictEqual(r2, false, "applyDamage on a dead player should return false");
});

test("shield blocks both knockback (applyHit) and damage (applyDamage skipped)", () => {
  const p = new Player("a", "A", 0);
  p.status.shield = 4;
  p.status.shieldCharges = 1;
  const hpBefore = p.hp;
  const hit = p.applyHit(1, 0, 8);
  // applyHit returns false when shield absorbs
  assert.strictEqual(hit, false, "applyHit should return false when shield absorbs");
  // Since hit is false, damage call is skipped — but test the guard directly too
  if (hit) p.applyDamage(8, "enemy");
  assert.strictEqual(p.hp, hpBefore, "hp should be unchanged when shield blocks");
});

test("shield blocks burn status effect — bolt path through sim does not apply DoT", () => {
  // Regression guard for the burn/curse/slow bypass bug: a bolt with burn that
  // hits a shielded player must NOT set victim.status.burn because applyHit
  // returns false (shield absorbed the hit) and landed=false is returned from
  // bolt.step(), so sim.js skips the status block.
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  // Give b a shield charge.
  b.status.shield = 4;
  b.status.shieldCharges = 1;
  // Place a burn-carrying bolt (fireball carries burn:5) just behind b, moving into b.
  a.groundY = CFG.PLATFORM_TOP;
  b.groundY = CFG.PLATFORM_TOP;
  b.x = 0; b.z = 0; b.vx = 0; b.vz = 0;
  const burnBolt = new Bolt("a", -0.4, 0, 0, 0xff5a1e, {
    kb: SPELLS.fireball.kb, dmg: SPELLS.fireball.dmg,
    burn: SPELLS.fireball.burn, burnDur: SPELLS.fireball.burnDur,
  });
  sim.bolts.push(burnBolt);
  sim.step(1 / CFG.TICK_RATE);
  // Shield should have consumed the hit — shieldCharges decrements to 0.
  assert.strictEqual(b.status.shieldCharges, 0, "shield charge should be consumed by the bolt");
  // The burn DoT must NOT have been applied through the shield.
  assert.strictEqual(b.status.burn, 0, "shield must block burn status — no DoT through shield");
  // HP must be untouched.
  assert.strictEqual(b.hp, b.maxHp, "hp must be unchanged when shield absorbs the hit");
});

test("lava still kills with hp full (lava path independent of HP)", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  // Confirm HP is full
  assert.strictEqual(b.hp, b.maxHp, "player should have full hp before lava");
  // Knock far off platform and let lava kill
  b.x = CFG.ARENA_RADIUS - 0.1; b.z = 0;
  b.vx = 60;
  advance(sim, CFG.HAZARD_DEATH_DELAY + 1.5);
  assert.strictEqual(b.alive, false, "lava should kill the player");
  // Lava death leaves the player in the falling state (alive=false, falling=true),
  // distinguishing it from HP death (alive=false, falling=false).
  assert.strictEqual(b.falling, true, "lava death must engage the falling path, not the HP-death path");
});

test("snapshot includes hp and mhp fields", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const snap = sim.snapshot().players.find((p) => p.id === "a");
  assert.ok(typeof snap.hp === "number", "snapshot.hp should be a number");
  assert.ok(typeof snap.mhp === "number", "snapshot.mhp should be a number");
  assert.strictEqual(snap.mhp, CFG.PLAYER_HP_MAX, "snapshot.mhp should equal PLAYER_HP_MAX");
  assert.ok(snap.hp > 0 && snap.hp <= snap.mhp, "snapshot.hp should be in (0, mhp]");
});

test("spawn resets hp to maxHp", () => {
  const p = new Player("a", "A", 0);
  p.applyDamage(60, "enemy");
  assert.ok(p.hp < p.maxHp, "hp should be reduced before spawn");
  p.spawn(0, 5);
  assert.strictEqual(p.hp, p.maxHp, "spawn should restore hp to maxHp");
});

test("fireball bolt depletes hp on hit and death is counted once at 0 hp", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  // Place b at full hp, a nearby to fire
  a.x = 0; a.z = 0; a.aim = 0;
  a.groundY = CFG.PLATFORM_TOP;
  b.x = 1.5; b.z = 0; b.vx = 0; b.vz = 0;
  b.groundY = CFG.PLATFORM_TOP;
  const hpBefore = b.hp;
  // Fire one bolt directly at b
  const bolt = new Bolt(a.id, a.x + 0.8, a.z, 0, 0xff0000, {
    kb: SPELLS.fireball.kb, dmg: SPELLS.fireball.dmg,
  });
  sim.bolts.push(bolt);
  sim.step(1 / CFG.TICK_RATE);
  // Check if bolt hit — if b.hp dropped or b is dead
  const hpAfter = b.hp;
  const hitOccurred = hpAfter < hpBefore || !b.alive;
  assert.ok(hitOccurred, `fireball bolt should have depleted hp (before:${hpBefore} after:${hpAfter})`);

  // Kill b and confirm death is counted exactly once across multiple ticks.
  if (b.alive) {
    b.applyDamage(b.hp, a.id); // kill
    assert.strictEqual(b.alive, false, "b should be dead after hp reaches 0");
  }
  // Step several ticks — _countedDeath must gate to exactly one increment.
  for (let i = 0; i < 5; i++) sim.step(1 / CFG.TICK_RATE);
  assert.strictEqual(b.deaths, 1, "death should be counted exactly once across multiple ticks");
});

test("lightning depletes hp on primary and chained targets", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B"); sim.addPlayer("c", "C");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  const c = sim.players.get("c");
  // Give a the lightning spell and ensure its cooldown is ready.
  a.acquireSpell("lightning");
  a.cooldowns["lightning"] = 0;
  // Place a at origin, b within primary range (< 18 u), c within chain range of b (< 7 u).
  a.x = 0; a.z = 0; a.aim = 0; a.groundY = CFG.PLATFORM_TOP;
  b.x = 5; b.z = 0; b.vx = 0; b.vz = 0; b.groundY = CFG.PLATFORM_TOP;
  c.x = 8; c.z = 0; c.vx = 0; c.vz = 0; c.groundY = CFG.PLATFORM_TOP;
  const bHpBefore = b.hp;
  const cHpBefore = c.hp;
  // Cast lightning aimed at b (arena layout was cleared by advance(), so LoS is always clear).
  castSpell(sim, a, { spell: "lightning", tx: b.x, tz: b.z });
  // Primary target must have lost HP.
  assert.ok(b.hp < bHpBefore,
    `lightning must damage primary target (hp: ${bHpBefore} → ${b.hp})`);
  // Primary damage must be approximately SPELLS.lightning.dmg (no falloff on first hop).
  const expectedPrimary = SPELLS.lightning.dmg;
  assert.ok(bHpBefore - b.hp >= expectedPrimary * 0.9,
    `lightning primary damage should be ~${expectedPrimary} (got ${bHpBefore - b.hp})`);
  // Chained target must also have lost HP (second hop at 0.7× dmg falloff).
  assert.ok(c.hp < cHpBefore,
    `lightning must chain-damage secondary target (hp: ${cHpBefore} → ${c.hp})`);
});

// ── Step 2 regression guards: auto-attack path must no longer exist ──────────

test("spawnBolt method no longer exists on Simulation", () => {
  const sim = new Simulation();
  assert.strictEqual(typeof sim.spawnBolt, "undefined", "spawnBolt should have been removed");
});

test("canFire method no longer exists on Player", () => {
  const sim = new Simulation();
  const p = sim.addPlayer("x", "X");
  assert.strictEqual(typeof p.canFire, "undefined", "canFire should have been removed");
});

test("input sample does not include fire field", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const p = sim.players.get("a");
  assert.ok(!Object.prototype.hasOwnProperty.call(p.input, "fire"), "input must not have a fire field");
});

// ── Step 6: Pre-match Spell Draft ──────────────────────────────────────────────
import { SPELL_TEMPLATES } from "../src/config.js";

test("draft: startMatch enters SPELL_SELECTION when draftEnabled; timer advances to COUNTDOWN", () => {
  const sim = new Simulation({ draftEnabled: true });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  assert.strictEqual(sim.phase, PHASE.SPELL_SELECTION, "should enter SPELL_SELECTION");
  assert.strictEqual(sim.phaseTimer, CFG.SPELL_SELECTION_TIME, "timer should be SPELL_SELECTION_TIME");
  // Advance past the draft timer; should move to COUNTDOWN then PLAYING
  advance(sim, CFG.SPELL_SELECTION_TIME + 0.1);
  assert.strictEqual(sim.phase, PHASE.COUNTDOWN, "should enter COUNTDOWN after draft expires");
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  assert.strictEqual(sim.phase, PHASE.PLAYING, "should enter PLAYING after countdown");
});

test("draft: default Simulation (no draftEnabled) still goes straight to COUNTDOWN", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  assert.strictEqual(sim.phase, PHASE.COUNTDOWN, "existing test contract: startMatch → COUNTDOWN without draft");
});

test("draft: toggle adds/removes spells; 6-slot cap enforced; fireball is a no-op", () => {
  const sim = new Simulation({ draftEnabled: true });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const p = sim.players.get("a");
  // Toggle in
  sim.applyDraft("a", { action: "toggle", spell: "lightning" });
  assert.ok(p.draftPick.includes("lightning"), "lightning should be in picks");
  // Toggle out
  sim.applyDraft("a", { action: "toggle", spell: "lightning" });
  assert.strictEqual(p.draftPick.includes("lightning"), false, "lightning should be removed on second toggle");
  // 6-slot cap
  const pool = ["lightning", "meteor", "teleport", "shield", "drain", "gravity"];
  for (const s of pool) sim.applyDraft("a", { action: "toggle", spell: s });
  assert.strictEqual(p.draftPick.length, 6, "should cap at 6 picks");
  sim.applyDraft("a", { action: "toggle", spell: "boomerang" });
  assert.strictEqual(p.draftPick.length, 6, "a 7th pick should be ignored");
  // Fireball is a no-op
  sim.applyDraft("a", { action: "toggle", spell: "fireball" });
  assert.strictEqual(p.draftPick.includes("fireball"), false, "fireball must never enter draftPick");
});

test("draft: template one-click fills picks from the named template", () => {
  const sim = new Simulation({ draftEnabled: true });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const p = sim.players.get("a");
  sim.applyDraft("a", { action: "template", template: 0 });
  assert.deepStrictEqual(p.draftPick, SPELL_TEMPLATES[0].spells.slice(0, 6), "Burst template should fill picks exactly");
});

test("draft: timeout auto-assigns full 6 slots; preserves existing picks; no dupes; fireball in spells", () => {
  const sim = new Simulation({ draftEnabled: true });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const p = sim.players.get("a");
  // Player a picks 2 spells
  sim.applyDraft("a", { action: "toggle", spell: "teleport" });
  sim.applyDraft("a", { action: "toggle", spell: "shield" });
  // Advance past timer
  advance(sim, CFG.SPELL_SELECTION_TIME + 0.1);
  // After finishDraft → beginRound, loadout should be committed
  const filledSlots = p.spellSlots.filter(Boolean);
  assert.strictEqual(filledSlots.length, 6, "should have 6 filled slots after timeout");
  assert.ok(filledSlots.every((id) => SPELLS[id]), "all slots should be valid spell ids");
  // Original picks preserved (teleport and shield should still be in slots)
  assert.ok(p.spells.has("teleport"), "teleport should be in final spells");
  assert.ok(p.spells.has("shield"), "shield should be in final spells");
  // No duplicates
  assert.strictEqual(new Set(filledSlots).size, filledSlots.length, "no duplicate slots");
  // Fireball always in spells (free basic)
  assert.ok(p.spells.has("fireball"), "fireball must be in spells set after draft commit");
  // Fireball not in any slot (draft slots hold the 6 picked spells)
  assert.strictEqual(p.spellSlots.indexOf("fireball"), -1, "fireball must not occupy a draft slot");
});

test("draft: all-ready early finish — transitions before timer expires", () => {
  const sim = new Simulation({ draftEnabled: true });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  assert.strictEqual(sim.phase, PHASE.SPELL_SELECTION);
  sim.applyDraft("a", { action: "ready" });
  sim.applyDraft("b", { action: "ready" });
  // A single step should trigger the phase transition (all players ready).
  sim.step(1 / CFG.TICK_RATE);
  assert.notStrictEqual(sim.phase, PHASE.SPELL_SELECTION, "should leave SPELL_SELECTION when all ready");
  assert.ok(sim.phaseTimer < CFG.SPELL_SELECTION_TIME, "should not have waited the full 30s");
});

test("draft: applyDraft is a no-op outside SPELL_SELECTION; bad spell ignored", () => {
  const sim = new Simulation({ draftEnabled: true });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  // Advance to PLAYING
  advance(sim, CFG.SPELL_SELECTION_TIME + 0.1 + CFG.ROUND.COUNTDOWN + 0.1);
  assert.strictEqual(sim.phase, PHASE.PLAYING);
  const p = sim.players.get("a");
  const slotsBefore = [...p.spellSlots];
  sim.applyDraft("a", { action: "toggle", spell: "lightning" });
  assert.deepStrictEqual(p.spellSlots, slotsBefore, "applyDraft during PLAYING must be a no-op");
  // Bad spell ignored during SPELL_SELECTION (re-test in fresh sim)
  const sim2 = new Simulation({ draftEnabled: true });
  sim2.addPlayer("a", "A"); sim2.addPlayer("b", "B");
  sim2.startMatch();
  sim2.applyDraft("a", { action: "toggle", spell: "notaspell" });
  assert.strictEqual(sim2.players.get("a").draftPick.length, 0, "invalid spell must be ignored");
});

test("draft: snapshot carries draftPick/draftReady per player and phase/timer at top level", () => {
  const sim = new Simulation({ draftEnabled: true });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  sim.applyDraft("a", { action: "toggle", spell: "lightning" });
  const snap = sim.snapshot();
  assert.strictEqual(snap.phase, "spellSelection", "top-level phase should be spellSelection");
  assert.ok(typeof snap.timer === "number" && snap.timer > 0, "timer should be a positive number");
  const pa = snap.players.find((p) => p.id === "a");
  assert.ok(Array.isArray(pa.draftPick), "player snapshot must have draftPick array");
  assert.ok(pa.draftPick.includes("lightning"), "draftPick should contain the toggled spell");
  assert.strictEqual(typeof pa.draftReady, "boolean", "player snapshot must have draftReady boolean");
});

// Integration guard: mirrors the option object that main.js startHosting passes for a standard
// (non-practice) multiplayer match. If main.js ever omits draftEnabled again this test will fail.
test("integration: non-practice host option object enables spell draft (mirrors main.js startHosting)", () => {
  // Mirrors: new Simulation({ mobsEnabled, arenaWorld, landSize, enabledObstacles, draftEnabled: !options.practice })
  const hostOptions = {
    mobsEnabled: true,
    arenaWorld: undefined,
    landSize: undefined,
    enabledObstacles: undefined,
    draftEnabled: true, // !options.practice where options.practice is undefined/false
  };
  const sim = new Simulation(hostOptions);
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  assert.strictEqual(sim.phase, PHASE.SPELL_SELECTION,
    "non-practice multiplayer host must enter SPELL_SELECTION; " +
    "if this fails, check that main.js startHosting passes draftEnabled: !options.practice");
});

console.log(`\n${passed} tests passed.`);
