// Unit tests for src/loop/fixedTimestep.ts's makeAccumulator, plus a
// replay-parity check against the existing p0-replay-harness golden fixtures
// (test/replay/) — design §8(d): "new useHostLoop accumulator emits
// byte-identical snapshot stream vs golden main.js hostLoop."
//
// makeAccumulator is pure (no DOM/rAF), so this whole file runs in the
// default `node` environment like every other pure-logic test in this repo.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { makeAccumulator } from "../src/loop/fixedTimestep.js";
import { runReplay } from "./replay/run-replay.mjs";
import { Simulation } from "../src/sim.js";
import { CFG } from "../src/config.js";
import { _resetBoltIds } from "../src/bolt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "replay", "fixtures");

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8"));
}

function stripT(snapshots) {
  return snapshots.map(({ t, ...rest }) => rest);
}

describe("makeAccumulator", () => {
  // `makeAccumulator()`/`.reset()` seed `last` from the REAL performance.now().
  // Every test below anchors its synthetic `now` sequence to a real
  // performance.now() reading taken immediately after construction, so the
  // very first `.steps()` call sees a tiny (sub-tick), not huge, initial dt —
  // its result is discarded (not asserted) as a "priming" call; every call
  // after that is purely relative to a clock this test fully controls (steps()
  // sets `last = now` unconditionally on every call).

  it("drains exactly one tick per tickMs of elapsed time under exact cadence", () => {
    const accum = makeAccumulator(30); // tickMs = 33.333...
    const tickMs = 1000 / 30;
    let now = performance.now();
    accum.steps(now); // prime; discard result (sub-tick dt since construction)
    for (let i = 0; i < 10; i++) {
      now += tickMs;
      const { n, stepDt } = accum.steps(now);
      expect(n).toBe(1);
      expect(stepDt).toBeCloseTo(1 / 30, 10);
    }
  });

  it("accumulates fractional time across calls instead of dropping it", () => {
    const accum = makeAccumulator(30);
    const tickMs = 1000 / 30;
    let now = performance.now();
    accum.steps(now); // prime
    // Two half-tick frames should drain exactly one whole tick total, not zero.
    now += tickMs / 2;
    expect(accum.steps(now).n).toBe(0);
    now += tickMs / 2;
    expect(accum.steps(now).n).toBe(1);
  });

  it("clamps a huge stall (e.g. a backgrounded tab) to 100ms of catch-up", () => {
    const accum = makeAccumulator(30);
    const now0 = performance.now();
    accum.steps(now0); // prime
    const { n } = accum.steps(now0 + 5000); // "5s" stall relative to the primed baseline
    // 100ms clamp / tickMs(~33.33ms) = 3 ticks, not ~150.
    expect(n).toBe(3);
  });

  it("reset() zeroes the accumulator and re-seeds `last` from real time", () => {
    const accum = makeAccumulator(30);
    const now0 = performance.now();
    accum.steps(now0); // prime
    accum.steps(now0 + 1000); // build up a large gap from the primed baseline
    accum.reset(); // re-seeds `last` from the REAL performance.now()
    const { n } = accum.steps(performance.now() + 0.001); // ~0ms since reset
    expect(n).toBe(0);
  });
});

describe("accumulator replay-parity vs the golden p0-replay-harness", () => {
  // Re-derives the golden `sim.step()` sequence but through makeAccumulator
  // instead of runReplay's direct fixed loop, fed a perfectly-cadenced
  // synthetic clock (one accumulator call == one tickMs of elapsed time) —
  // the exact cadence useHostLoop assumes when rAF fires on schedule. Per-tick
  // input application intentionally mirrors run-replay.mjs's logic (same
  // latch/cast-seq rules) so the two harnesses are apples-to-apples; only the
  // OUTER loop (fixed vs accumulator-driven) differs.
  function runReplayWithAccumulator(fixture) {
    _resetBoltIds();
    const sim = new Simulation({ seed: fixture.seed, ...(fixture.config || {}) });
    for (const pl of fixture.players) sim.addPlayer(pl.id, pl.name, pl.options || {});
    if (fixture.botRoster) sim.setBotRoster(fixture.botRoster.count, fixture.botRoster.skill);
    if (!fixture.start || fixture.start === "match") sim.startMatch();

    const byTick = new Map();
    for (const entry of fixture.inputTimeline || []) {
      if (!byTick.has(entry.tick)) byTick.set(entry.tick, []);
      byTick.get(entry.tick).push(entry);
    }
    const latched = new Map();
    const inputSeq = new Map();
    const castSeq = new Map();
    const nextSeq = (id) => { const s = (inputSeq.get(id) || 0) + 1; inputSeq.set(id, s); return s; };
    const nextCastId = (id) => { const c = (castSeq.get(id) || 0) + 1; castSeq.set(id, c); return c; };

    const realNow = Date.now;
    let simClockMs = 0;
    const out = [];
    const accum = makeAccumulator(CFG.TICK_RATE);
    accum.reset();
    let rafNow = 0;
    const tickMs = 1000 / CFG.TICK_RATE;
    try {
      Date.now = () => simClockMs;
      let tick = 0;
      while (tick < fixture.ticks) {
        rafNow += tickMs; // perfectly-cadenced synthetic rAF clock
        const { n, stepDt } = accum.steps(rafNow);
        for (let i = 0; i < n && tick < fixture.ticks; i++, tick++) {
          const entries = byTick.get(tick);
          if (entries) {
            for (const entry of entries) {
              for (const [pid, input] of Object.entries(entry.inputs || {})) {
                const prev = latched.get(pid) || { move: [0, 0], aim: 0 };
                const move = Array.isArray(input.move) ? input.move : prev.move;
                const aim = Number.isFinite(input.aim) ? input.aim : prev.aim;
                latched.set(pid, { move, aim });
                const casts = (input.casts || []).map((c) => ({
                  id: nextCastId(pid), spell: c.spell, tx: c.tx, tz: c.tz,
                }));
                sim.setInput(pid, { move, aim, seq: nextSeq(pid), casts });
              }
            }
          }
          simClockMs += 1000 / CFG.TICK_RATE;
          sim.step(stepDt);
          out.push(sim.snapshot());
        }
      }
    } finally {
      Date.now = realNow;
    }
    return out;
  }

  for (const file of ["spell-cast-seed42", "mob-spawn-seed1337", "arena-shrink-seed7"]) {
    it(`${file}: accumulator-driven stepping is byte-identical to the golden fixed-step harness`, () => {
      const fixture = loadFixture(file);
      const golden = stripT(runReplay(fixture));
      const viaAccumulator = stripT(runReplayWithAccumulator(fixture));
      expect(viaAccumulator).toHaveLength(fixture.ticks);
      expect(JSON.stringify(viaAccumulator)).toBe(JSON.stringify(golden));
    });
  }
});
