// Headless smoke + logic tests for bot AI (WS-E: draft-aware loadouts,
// mobility recovery, mob awareness, ring-shrink lookahead, determinism).
// Run with: node test/bot.test.mjs
import assert from "node:assert";
import { Simulation, PHASE } from "../src/sim.js";
import { CFG, SPELLS } from "../src/config.js";
import { BOT_PROFILES, botDraftPick } from "../src/bot.js";
import { makePrng, idSeed } from "../src/rng.js";
import { _resetBoltIds } from "../src/bolt.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

function advance(sim, seconds, dt = 1 / CFG.TICK_RATE) {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
}

const ESCAPE_SPELLS = ["teleport", "blink", "windWalk", "rush", "thrust"];
const TIERS = ["smart", "brilliant", "expert"];

console.log("Bot AI tests:");

// ── (1) botDraftPick is deterministic for a fixed seed ─────────────────────
test("botDraftPick is deterministic for a fixed seed", () => {
  const profile = BOT_PROFILES.expert;
  const rand1 = makePrng(idSeed("bot:1:draft"));
  const rand2 = makePrng(idSeed("bot:1:draft"));
  const picks1 = botDraftPick(profile, rand1);
  const picks2 = botDraftPick(profile, rand2);
  assert.deepStrictEqual(picks1, picks2, "same seed must produce identical picks");
});

// ── (2) always 6 unique legal spells incl. >=1 escape, across many seeds ──
test("botDraftPick always returns 6 unique legal spells with an escape spell (100 seeds x 3 tiers)", () => {
  for (const tier of TIERS) {
    const profile = BOT_PROFILES[tier];
    for (let seed = 0; seed < 100; seed++) {
      const rand = makePrng(idSeed(`bot:${tier}:${seed}`));
      const picks = botDraftPick(profile, rand);
      assert.strictEqual(picks.length, CFG.SPELL_SLOT_COUNT, `${tier} seed ${seed}: must return ${CFG.SPELL_SLOT_COUNT} picks`);
      assert.strictEqual(new Set(picks).size, picks.length, `${tier} seed ${seed}: picks must be unique`);
      assert.ok(picks.every((id) => SPELLS[id] && id !== "fireball"), `${tier} seed ${seed}: every pick must be a legal, non-fireball spell`);
      assert.ok(picks.some((id) => ESCAPE_SPELLS.includes(id)), `${tier} seed ${seed}: must include at least one escape/mobility spell (got ${picks.join(",")})`);
    }
  }
});

// ── (3) selectAbility returns a mobility spell when placed at the edge ─────
test("bot at the arena edge with only windWalk equipped uses windWalk to escape", () => {
  const sim = new Simulation();
  sim.setBotRoster(2, "expert");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
  const [bot] = sim.botPlayers();
  // Strip the bot down to only windWalk (no thrust/teleport/blink/rush) so the
  // generalized mobility-recovery branch is exercised, not the old thrust path.
  bot.setLoadout(["windWalk"]);
  bot.x = sim.arena.radius - 1.5; bot.z = 0; bot.vx = 0; bot.vz = 0;
  bot._nextBotAbilityAt = 0;
  bot.cooldowns = {};
  let usedWindWalk = false;
  for (let i = 0; i < 5 && !usedWindWalk; i++) {
    sim.step(1 / CFG.TICK_RATE);
    if (sim.events.some((e) => e.type === "windwalk" && e.id === bot.id)) usedWindWalk = true;
  }
  assert.ok(usedWindWalk, "expert bot near the arena edge with only windWalk equipped should use it to escape");
});

// ── (4) loadout variety: across 20 seeds, expert picks >= 8 distinct spells ─
test("botDraftPick produces real kit variety for the expert tier across seeds", () => {
  const seen = new Set();
  const profile = BOT_PROFILES.expert;
  for (let seed = 0; seed < 20; seed++) {
    const rand = makePrng(idSeed(`bot:variety:${seed}`));
    for (const id of botDraftPick(profile, rand)) seen.add(id);
  }
  assert.ok(seen.size >= 8, `expert should draft at least 8 distinct spells across 20 seeds, saw ${seen.size}: ${[...seen].join(",")}`);
});

// ── (5) full-sim determinism: same seed + roster -> identical bot loadouts
//        and identical state hash after N ticks ────────────────────────────
function buildDraftSim() {
  // Bolt ids come from a module-level counter (see bolt.js's _resetBoltIds
  // test helper) rather than a per-Simulation one, so two sims built back to
  // back in the same process would otherwise start their bolt ids at
  // different numbers — reset it so bolt ids line up across the two runs.
  _resetBoltIds();
  const sim = new Simulation({ seed: 7, draftEnabled: true });
  sim.setBotRoster(3, "brilliant");
  assert.strictEqual(sim.startMatch(), true);
  // Draft phase resolves purely from the timer/bot auto-ready; advance straight
  // through SPELL_SELECTION -> COUNTDOWN -> PLAYING.
  advance(sim, CFG.SPELL_SELECTION_TIME + 0.1 + CFG.ROUND.COUNTDOWN + 0.1);
  assert.strictEqual(sim.phase, PHASE.PLAYING, "sim should reach PLAYING after draft + countdown");
  // The procedural map generator places obstacles via its own internal
  // Math.random() (a pre-existing, unrelated non-determinism — see the
  // identical workaround in test/sim.test.mjs's advance()), so clear the
  // layout before comparing state: bot AI determinism is what's under test
  // here, not obstacle placement.
  sim.arena.setLayout(null);
  return sim;
}

test("draft-enabled sim: bot loadouts and state hash are deterministic for the same seed", () => {
  const simA = buildDraftSim();
  const simB = buildDraftSim();

  const botsA = simA.botPlayers();
  const botsB = simB.botPlayers();
  assert.strictEqual(botsA.length, botsB.length);
  for (let i = 0; i < botsA.length; i++) {
    assert.deepStrictEqual(
      [...botsA[i].spellSlots].sort(),
      [...botsB[i].spellSlots].sort(),
      `bot ${i} committed draft loadout must match across identical-seed sims`
    );
  }

  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < 200; t++) {
    simA.arena.setLayout(null);
    simB.arena.setLayout(null);
    simA.step(dt);
    simB.step(dt);
  }
  // Normalize away fields that are not meaningful game state for a
  // determinism check: snapshot().t is Date.now() (wall clock), and bolt ids
  // come from a *module-level* counter in bolt.js shared across every
  // Simulation instance in the process (see _resetBoltIds) — a bolt that's
  // created and cancelled/removed in the same tick (e.g. opposing-projectile
  // clash) silently consumes an id without appearing in either snapshot, so
  // two behaviorally-identical runs can still land on different raw id
  // numbers. Bot AI determinism is what's under test, not the id counter.
  const normalize = (sim) => {
    const { t, bolts, ...rest } = sim.snapshot();
    return { ...rest, bolts: bolts.map(({ id, ...b }) => b) };
  };
  const hashA = JSON.stringify(normalize(simA));
  const hashB = JSON.stringify(normalize(simB));
  assert.strictEqual(hashA, hashB, "two identically-seeded sims must produce an identical state hash after N ticks");
});

// ── Longer headless sanity sim: no throw, at least one mobility cast ───────
test("longer headless sanity sim: 3 bots, 2000 ticks, no throw, at least one mobility cast", () => {
  const sim = new Simulation({ seed: 99 });
  sim.setBotRoster(3, "expert");
  assert.strictEqual(sim.startMatch(), true);
  const dt = 1 / CFG.TICK_RATE;
  const MOBILITY_EVENT_TYPES = new Set(["thrust", "teleport", "windwalk", "rush"]);
  let sawMobilityCast = false;
  assert.doesNotThrow(() => {
    for (let i = 0; i < 2000; i++) {
      sim.arena.setLayout(null);
      sim.step(dt);
      if (sim.events.some((e) => MOBILITY_EVENT_TYPES.has(e.type))) sawMobilityCast = true;
      if (sim.phase === PHASE.COUNTDOWN && sim.round > 1 && sim.phaseTimer > CFG.ROUND.COUNTDOWN - 0.01) {
        // Round just restarted; nothing special to do, just keep advancing.
      }
    }
  }, "a long headless sim run should never throw");
  assert.ok(sawMobilityCast, "a 2000-tick, 3-bot sim should produce at least one mobility cast");
});

console.log(`${passed} bot AI tests passed.`);
