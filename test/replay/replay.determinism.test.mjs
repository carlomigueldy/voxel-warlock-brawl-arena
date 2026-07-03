// Determinism suite for the seeded sim-replay harness (test/replay/run-replay.mjs).
// For each fixture, running the exact same scripted timeline twice must
// produce byte-identical snapshot sequences (modulo the wall-clock `t`
// field, which is excluded from equality — see run-replay.mjs for how
// Date.now() is stubbed to a monotonic sim clock during the run). Each
// scenario also carries a non-vacuous assertion so a harness bug that makes
// every snapshot trivially empty/equal can't slip through as a false pass.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runReplay } from "./run-replay.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8"));
}

// Strip the non-deterministic `t` field (Date.now() at snapshot time) from
// every snapshot before comparing. Defense-in-depth: run-replay.mjs already
// stubs Date.now() to a monotonic sim clock for the duration of the replay,
// so `t` is actually deterministic too — this strip just makes the equality
// check robust to that implementation detail changing.
function stripT(snapshots) {
  return snapshots.map(({ t, ...rest }) => rest);
}

const SCENARIOS = [
  {
    file: "spell-cast-seed42",
    describeNonVacuous: "some snapshot has a live fireball bolt (bolts.length > 0)",
    assertNonVacuous(snapshots) {
      expect(snapshots.some((s) => s.bolts.length > 0)).toBe(true);
    },
  },
  {
    file: "mob-spawn-seed1337",
    describeNonVacuous: "some snapshot has a spawned mob (mobs.length > 0)",
    assertNonVacuous(snapshots) {
      expect(snapshots.some((s) => s.mobs.length > 0)).toBe(true);
    },
  },
  {
    file: "arena-shrink-seed7",
    describeNonVacuous: "arenaR strictly decreases (never increases, and is lower at the end than the start)",
    assertNonVacuous(snapshots) {
      for (let i = 1; i < snapshots.length; i++) {
        expect(snapshots[i].arenaR).toBeLessThanOrEqual(snapshots[i - 1].arenaR);
      }
      expect(snapshots[snapshots.length - 1].arenaR).toBeLessThan(snapshots[0].arenaR);
    },
  },
];

describe("sim-replay determinism", () => {
  for (const { file, describeNonVacuous, assertNonVacuous } of SCENARIOS) {
    describe(file, () => {
      const fixture = loadFixture(file);
      const runA = runReplay(fixture);
      const runB = runReplay(fixture);

      it(`produces exactly fixture.ticks (${fixture.ticks}) snapshots on every run`, () => {
        expect(runA).toHaveLength(fixture.ticks);
        expect(runB).toHaveLength(fixture.ticks);
      });

      it("two independent runs of the same fixture are deep-equal (excluding t)", () => {
        const a = stripT(runA);
        const b = stripT(runB);
        expect(a).toEqual(b);
        // Belt-and-suspenders: byte-identical serialization, not just deep-equal.
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      });

      it(describeNonVacuous, () => {
        assertNonVacuous(stripT(runA));
      });
    });
  }
});
