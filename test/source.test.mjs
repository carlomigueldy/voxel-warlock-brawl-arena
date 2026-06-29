import assert from "node:assert";
import fs from "node:fs";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

console.log("Source integration checks:");

const main = fs.readFileSync("src/main.js", "utf8");
const ui = fs.readFileSync("src/ui.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

test("host start is gated by Simulation.startMatch result", () => {
  assert.match(main, /if \(!sim\.startMatch\(\)\)/);
});

test("host lobby start button uses Simulation.canStartMatch", () => {
  assert.match(main, /sim\.canStartMatch\(\)/);
});

test("late clients switch to game view from active state snapshots", () => {
  assert.match(main, /snap\.phase !== PHASE\.LOBBY[\s\S]*ui\.showGame\(\)/);
});

test("clients ignore stale state snapshots", () => {
  assert.match(main, /snap\.t <= latestSnapshot\.t/);
});

test("scoreboard rendering avoids interpolating player names into innerHTML", () => {
  assert.doesNotMatch(ui, /rows\.map\([\s\S]*innerHTML/);
});

test("center messages escape dynamic player names", () => {
  assert.match(ui, /escapeHTML/);
  assert.match(ui, /escapeHTML\(w\)/);
});

test("network join names are sanitized as strings before slicing", () => {
  const net = fs.readFileSync("src/net.js", "utf8");
  assert.match(net, /sanitizeName/);
  assert.match(net, /String\(name \?\? "warlock"\)/);
});

test("disconnect handling sends the host back to lobby when a match cannot continue", () => {
  assert.match(main, /if \(sim\.phase === PHASE\.LOBBY\)/);
  assert.match(main, /inGame = false/);
});

test("host menu exposes all-abilities-at-start toggle", () => {
  assert.match(html, /id="all-abilities-toggle"/);
  assert.match(ui, /allAbilitiesAtStart/);
  assert.match(main, /new Simulation\(\{ allAbilitiesAtStart/);
});

test("ability bar filters slots by acquired spells from snapshots", () => {
  assert.match(ui, /me\?\.spells/);
  assert.match(ui, /slot\.classList\.toggle\("locked"/);
});

console.log(`\n${passed} source checks passed.`);
