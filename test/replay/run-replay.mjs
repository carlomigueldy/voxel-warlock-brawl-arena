// Deterministic seeded sim-replay harness.
//
// Drives a headless `Simulation` through a scripted input timeline at the
// fixed host tick rate (`CFG.TICK_RATE`) and returns the array of snapshots
// produced — one per tick, in order. This is the foundation of the
// zero-regression safety net: any future refactor of `src/sim.js` (or the
// modules it composes) can be verified against a recorded fixture by diffing
// `runReplay(fixture)` output.
//
// Harness-only determinism-hazard neutralization (NO src/** changes):
//  - `Math.random` fallback in `Simulation` (src/sim.js) is avoided entirely
//    by always constructing with a numeric `fixture.seed` — see src/rng.js
//    (Mulberry32) for why that alone makes the whole sim tree (map layout,
//    mob spawns, bot AI) reproducible.
//  - `Date.now()` is read in two places that would otherwise make replay
//    output wall-clock-dependent: `Simulation.snapshot()`'s `t` field, and
//    the kill-credit attribution window (`Player.recordAttacker` /
//    `resolveKillCredit`, see src/sim.js `step()`). We stub `Date.now` to a
//    monotonic clock that advances in lockstep with the sim tick rate for
//    the duration of the replay, and restore the real one in a `finally` so
//    a thrown error (bad fixture, sim bug) never leaves the process-global
//    `Date.now` patched for anything else that runs afterward (e.g. the next
//    test in the same Vitest worker).
//  - `performance.now()` is only read by render/input code (src/main.js,
//    src/input.js's `InputController`) — the harness never touches either,
//    so it's a non-issue here. Encode plain input objects instead of using
//    `InputController` (see `setInput` calls below).
//  - `Bolt` (src/bolt.js) assigns `.id` from a module-level counter that is
//    NOT reset per `Simulation` instance, so two `runReplay()` calls in the
//    same process (exactly what the determinism suite does) would otherwise
//    diverge on bolt ids alone even though gameplay is bit-identical.
//    src/bolt.js already exports `_resetBoltIds()` for this ("test helper"
//    in its own comment) — call it, don't touch src/bolt.js.
//
// The one behavioural subtlety worth calling out: `move`/`aim` LATCH across
// ticks (calling `Simulation.setInput` once persists that move/aim on the
// `Player` until a later timeline entry replaces it — the sim itself never
// resets it), but `casts` do NOT latch — a queued cast fires at most once,
// on the very tick it's authored, because `Simulation.step()` drains and
// clears `Player.pendingCasts` every tick (src/sim.js `step()`). So this
// harness only needs to call `setInput` on ticks that appear in the
// fixture's `inputTimeline`, merging any omitted `move`/`aim` from the last
// latched value (so a cast-only entry doesn't accidentally zero out
// movement) and assigning a fresh monotonic cast id/seq per player so
// `Simulation.setInput`'s stale-drop / cast-dedup guards never reject them.
import { Simulation } from "../../src/sim.js";
import { CFG } from "../../src/config.js";
import { _resetBoltIds } from "../../src/bolt.js";

/**
 * @typedef {object} ReplayInput
 * @property {[number, number]} [move]
 * @property {number} [aim]
 * @property {{spell:string, tx?:number, tz?:number}[]} [casts]
 *
 * @typedef {object} ReplayTimelineEntry
 * @property {number} tick
 * @property {Record<string, ReplayInput>} inputs - keyed by player id
 *
 * @typedef {object} ReplayFixture
 * @property {string} name
 * @property {number} seed
 * @property {object} [config] - spread into `new Simulation({ seed, ...config })`
 * @property {{id:string, name:string, options?:object}[]} players
 * @property {{count:number, skill?:string}} [botRoster] - optional `setBotRoster()` call
 * @property {"match"} [start] - defaults to "match" (calls `startMatch()`)
 * @property {number} ticks
 * @property {ReplayTimelineEntry[]} [inputTimeline]
 */

/**
 * Run a fixture through the simulation deterministically and return the
 * array of per-tick snapshots (`snapshots.length === fixture.ticks`).
 * @param {ReplayFixture} fixture
 * @returns {object[]} snapshots
 */
export function runReplay(fixture) {
  // See the module-doc note above: Bolt ids come from a module-level counter
  // that outlives any single Simulation instance, so reset it before every
  // run to keep repeated runReplay() calls in the same process deterministic.
  _resetBoltIds();
  const sim = new Simulation({ seed: fixture.seed, ...(fixture.config || {}) });
  for (const pl of fixture.players) sim.addPlayer(pl.id, pl.name, pl.options || {});
  if (fixture.botRoster) sim.setBotRoster(fixture.botRoster.count, fixture.botRoster.skill);
  if (!fixture.start || fixture.start === "match") sim.startMatch();

  const dt = 1 / CFG.TICK_RATE;

  // Index the timeline by tick for O(1) lookup per step.
  const byTick = new Map();
  for (const entry of fixture.inputTimeline || []) {
    if (!byTick.has(entry.tick)) byTick.set(entry.tick, []);
    byTick.get(entry.tick).push(entry);
  }

  // Last latched move/aim per player id — merged into partial timeline
  // entries (e.g. a cast-only entry) so we never accidentally overwrite a
  // standing move command with setInput's [0,0]/0 defaults.
  const latched = new Map(); // id -> { move:[number,number], aim:number }
  const inputSeq = new Map(); // id -> next monotonic setInput seq
  const castSeq = new Map(); // id -> next monotonic cast id

  const nextSeq = (id) => {
    const s = (inputSeq.get(id) || 0) + 1;
    inputSeq.set(id, s);
    return s;
  };
  const nextCastId = (id) => {
    const c = (castSeq.get(id) || 0) + 1;
    castSeq.set(id, c);
    return c;
  };

  const realNow = Date.now;
  let simClockMs = 0;
  const out = [];
  try {
    Date.now = () => simClockMs;
    for (let tick = 0; tick < fixture.ticks; tick++) {
      const entries = byTick.get(tick);
      if (entries) {
        for (const entry of entries) {
          for (const [pid, input] of Object.entries(entry.inputs || {})) {
            const prev = latched.get(pid) || { move: [0, 0], aim: 0 };
            const move = Array.isArray(input.move) ? input.move : prev.move;
            const aim = Number.isFinite(input.aim) ? input.aim : prev.aim;
            latched.set(pid, { move, aim });
            // Casts do NOT latch — only the casts authored on this exact
            // tick fire; each gets a fresh monotonic id so the sim's
            // dedup-by-id guard (setInput) never drops it as "already seen".
            const casts = (input.casts || []).map((c) => ({
              id: nextCastId(pid),
              spell: c.spell,
              tx: c.tx,
              tz: c.tz,
            }));
            sim.setInput(pid, { move, aim, seq: nextSeq(pid), casts });
          }
        }
      }

      simClockMs += 1000 / CFG.TICK_RATE;
      sim.step(dt);
      out.push(sim.snapshot());
    }
  } finally {
    Date.now = realNow;
  }
  return out;
}
