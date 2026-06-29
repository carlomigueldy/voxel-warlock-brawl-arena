import assert from "node:assert";
import { SPELLS } from "../src/config.js";
import {
  ARCHETYPES,
  ABILITY_ARCHETYPE,
  ARCHETYPE_DURATION,
  archetypeForAbility,
  archetypeForEvent,
  locomotionState,
  CastAnimator,
} from "../src/animations.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

console.log("Animation system tests:");

test("declares the five cast archetypes", () => {
  assert.deepStrictEqual(
    [...ARCHETYPES].sort(),
    ["attack", "buff", "channel", "dash", "slam"]
  );
});

test("every spellbook ability maps to a valid archetype", () => {
  for (const id of Object.keys(SPELLS)) {
    const arch = archetypeForAbility(id);
    assert.ok(arch, `ability ${id} has no archetype`);
    assert.ok(ARCHETYPES.includes(arch), `ability ${id} maps to invalid archetype ${arch}`);
  }
});

test("auto-attack / projectile casts use the attack archetype", () => {
  for (const id of ["fireball", "boomerang", "homing", "bouncer", "splitter", "fireSpray", "disable", "lightning"]) {
    assert.strictEqual(archetypeForAbility(id), "attack", `${id} should be attack`);
  }
});

test("area abilities use the slam archetype", () => {
  for (const id of ["meteor", "gravity"]) {
    assert.strictEqual(archetypeForAbility(id), "slam", `${id} should be slam`);
  }
});

test("mobility abilities use the dash archetype", () => {
  for (const id of ["teleport", "thrust", "swap"]) {
    assert.strictEqual(archetypeForAbility(id), "dash", `${id} should be dash`);
  }
});

test("self-buff abilities use the buff archetype", () => {
  for (const id of ["shield", "rush", "windWalk", "timeShift", "pocketWatch"]) {
    assert.strictEqual(archetypeForAbility(id), "buff", `${id} should be buff`);
  }
});

test("control/channel abilities use the channel archetype", () => {
  for (const id of ["drain", "link"]) {
    assert.strictEqual(archetypeForAbility(id), "channel", `${id} should be channel`);
  }
});

test("ABILITY_ARCHETYPE covers exactly the spellbook", () => {
  assert.deepStrictEqual(
    Object.keys(ABILITY_ARCHETYPE).sort(),
    Object.keys(SPELLS).sort()
  );
});

test("each archetype has a positive playback duration", () => {
  for (const a of ARCHETYPES) {
    assert.ok(ARCHETYPE_DURATION[a] > 0, `archetype ${a} needs a duration`);
  }
});

test("cast events resolve to caster id and attack archetype", () => {
  const r = archetypeForEvent({ type: "cast", spell: "fireball", id: "p1" });
  assert.deepStrictEqual(r, { id: "p1", archetype: "attack" });
});

test("lightning event resolves to the attack archetype", () => {
  const r = archetypeForEvent({ type: "lightning", id: "p2" });
  assert.deepStrictEqual(r, { id: "p2", archetype: "attack" });
});

test("meteor cast event resolves to the slam archetype", () => {
  const r = archetypeForEvent({ type: "meteorCast", id: "p3", x: 1, z: 2 });
  assert.deepStrictEqual(r, { id: "p3", archetype: "slam" });
});

test("gravity event resolves to the slam archetype", () => {
  const r = archetypeForEvent({ type: "gravity", id: "p4" });
  assert.deepStrictEqual(r, { id: "p4", archetype: "slam" });
});

test("mobility events resolve to the dash archetype", () => {
  for (const type of ["teleport", "thrust"]) {
    assert.deepStrictEqual(archetypeForEvent({ type, id: "px" }), { id: "px", archetype: "dash" });
  }
});

test("swap event resolves the initiating caster to dash", () => {
  const r = archetypeForEvent({ type: "swap", a: "pa", b: "pb" });
  assert.deepStrictEqual(r, { id: "pa", archetype: "dash" });
});

test("self-buff events resolve to the buff archetype", () => {
  for (const type of ["shield", "windwalk", "rush", "timeshift", "pocketwatch"]) {
    assert.deepStrictEqual(archetypeForEvent({ type, id: "pb" }), { id: "pb", archetype: "buff" });
  }
});

test("channel events resolve the caster to the channel archetype", () => {
  const r = archetypeForEvent({ type: "drain", a: "pc", b: "pd" });
  assert.deepStrictEqual(r, { id: "pc", archetype: "channel" });
  const r2 = archetypeForEvent({ type: "link", a: "pe", b: "pf" });
  assert.deepStrictEqual(r2, { id: "pe", archetype: "channel" });
});

test("non-animation events are ignored", () => {
  for (const type of ["hit", "death", "sfx", "runePickup", "spellConsumed", "meteorImpact"]) {
    assert.strictEqual(archetypeForEvent({ type, id: "p" }), null, `${type} should not animate the caster`);
  }
});

test("locomotion resolves fall, run, walk, and idle states", () => {
  assert.strictEqual(locomotionState({ speed: 0, maxSpeed: 9, falling: true }), "fall");
  assert.strictEqual(locomotionState({ speed: 8, maxSpeed: 9, falling: false }), "run");
  assert.strictEqual(locomotionState({ speed: 3, maxSpeed: 9, falling: false }), "walk");
  assert.strictEqual(locomotionState({ speed: 0.1, maxSpeed: 9, falling: false }), "idle");
});

test("falling overrides movement speed for locomotion", () => {
  assert.strictEqual(locomotionState({ speed: 9, maxSpeed: 9, falling: true }), "fall");
});

test("CastAnimator starts inactive", () => {
  const a = new CastAnimator();
  assert.strictEqual(a.active, false);
  assert.strictEqual(a.archetype, null);
  assert.strictEqual(a.weight, 0);
});

test("CastAnimator activates on trigger and reports its archetype", () => {
  const a = new CastAnimator();
  a.trigger("attack");
  assert.strictEqual(a.active, true);
  assert.strictEqual(a.archetype, "attack");
});

test("CastAnimator weight rises after triggering then update", () => {
  const a = new CastAnimator();
  a.trigger("attack");
  a.update(0.05);
  assert.ok(a.weight > 0, "weight should grow while active");
  assert.ok(a.weight <= 1, "weight never exceeds 1");
});

test("CastAnimator deactivates after the archetype duration elapses", () => {
  const a = new CastAnimator();
  a.trigger("attack");
  let t = 0;
  const dur = ARCHETYPE_DURATION.attack;
  while (t < dur + 0.5) { a.update(0.05); t += 0.05; }
  assert.strictEqual(a.active, false, "should finish after duration");
  assert.strictEqual(a.archetype, null);
});

test("CastAnimator retriggering restarts the timer with the new archetype", () => {
  const a = new CastAnimator();
  a.trigger("attack");
  a.update(ARCHETYPE_DURATION.attack - 0.05);
  a.trigger("slam");
  assert.strictEqual(a.archetype, "slam");
  assert.strictEqual(a.active, true);
});

console.log(`\n${passed} animation tests passed.`);
