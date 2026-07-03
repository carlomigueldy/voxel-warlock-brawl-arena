#!/usr/bin/env node
// Dev tool: record a scripted input timeline into a replay fixture JSON
// (test/replay/fixtures/<name>.json) consumed by test/replay/run-replay.mjs
// and test/replay/replay.determinism.test.mjs.
//
// Ships the 3 known scenarios the determinism suite pins on today, so
// `node scripts/record-replay.mjs <name>` reproduces the checked-in fixture
// deterministically. Sanity-runs runReplay() before writing anything so a
// broken/throwing timeline is never persisted as a fixture.
//
// Usage:
//   node scripts/record-replay.mjs spell-cast-seed42
//   node scripts/record-replay.mjs mob-spawn-seed1337 --golden
//
// --golden also writes test/replay/fixtures/<name>.snapshots.json — the full
// per-tick snapshot output with the non-deterministic `t` field stripped —
// as a golden fixture for future cross-renderer / cross-implementation
// parity checks (not read by the determinism suite itself).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runReplay } from "../test/replay/run-replay.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "test", "replay", "fixtures");

const SCENARIOS = {
  "spell-cast-seed42": () => ({
    name: "spell-cast-seed42",
    seed: 42,
    config: { mobsEnabled: false, draftEnabled: false },
    players: [
      { id: "p1", name: "Alice" },
      { id: "p2", name: "Bob" },
    ],
    start: "match",
    ticks: 150,
    inputTimeline: [
      { tick: 95, inputs: { p1: { move: [0, 0], aim: 0, casts: [{ spell: "fireball", tx: 5, tz: 0 }] } } },
    ],
  }),
  "mob-spawn-seed1337": () => ({
    name: "mob-spawn-seed1337",
    seed: 1337,
    config: { mobsEnabled: true, draftEnabled: false },
    players: [
      { id: "p1", name: "Alice" },
      { id: "p2", name: "Bob" },
    ],
    start: "match",
    ticks: 400,
    inputTimeline: [],
  }),
  "arena-shrink-seed7": () => ({
    name: "arena-shrink-seed7",
    seed: 7,
    config: { mobsEnabled: false, draftEnabled: false },
    players: [
      { id: "p1", name: "Alice" },
      { id: "p2", name: "Bob" },
    ],
    start: "match",
    ticks: 450,
    inputTimeline: [],
  }),
};

function main() {
  const [name, ...flags] = process.argv.slice(2);
  const build = name && SCENARIOS[name];
  if (!build) {
    console.error(`Usage: node scripts/record-replay.mjs <${Object.keys(SCENARIOS).join("|")}> [--golden]`);
    process.exitCode = 1;
    return;
  }

  const fixture = build();

  // Sanity-run before writing anything: a fixture that throws (or produces
  // the wrong number of ticks) is never persisted.
  const snapshots = runReplay(fixture);
  if (snapshots.length !== fixture.ticks) {
    throw new Error(`runReplay produced ${snapshots.length} snapshots, expected ${fixture.ticks} (fixture "${name}")`);
  }

  const fixturePath = path.join(FIXTURES_DIR, `${name}.json`);
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${fixturePath}`);

  if (flags.includes("--golden")) {
    const golden = snapshots.map(({ t, ...rest }) => rest);
    const goldenPath = path.join(FIXTURES_DIR, `${name}.snapshots.json`);
    writeFileSync(goldenPath, JSON.stringify(golden) + "\n");
    console.log(`wrote ${goldenPath}`);
  }
}

main();
