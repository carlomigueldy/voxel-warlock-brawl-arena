// Source guards for the UI layer: ui.js, input.js, index.html, style.css.
// Split from test/source.test.mjs (#103) by which source file each guard reads.
import { test } from "vitest";
import assert from "node:assert";
import fs from "node:fs";

console.log("Source guards (ui) checks:");

const ui = fs.readFileSync("src/ui.js", "utf8");
const input = fs.readFileSync("src/input.ts", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("src/style.css", "utf8");

// legacy text guard — delete in P6
test("scoreboard rendering avoids interpolating player names into innerHTML", () => {
  assert.doesNotMatch(ui, /rows\.map\([\s\S]*innerHTML/);
});

// legacy text guard — delete in P6
test("center messages escape dynamic player names", () => {
  assert.match(ui, /escapeHTML/);
  assert.match(ui, /escapeHTML\(w\)/);
});

// legacy text guard — delete in P6
test("host menu no longer exposes an all-abilities toggle (strict slots only)", () => {
  assert.doesNotMatch(html, /id="all-abilities-toggle"/);
  assert.doesNotMatch(ui, /allAbilitiesAtStart/);
});

// legacy text guard — delete in P6
test("menu exposes a character-select UI with cards and a live preview", () => {
  assert.match(html, /id="char-cards"/);
  assert.match(html, /id="char-preview"/);
  assert.match(ui, /_buildCharacterCards/);
  assert.match(ui, /CFG\.CHARACTERS/);
});

// legacy text guard — delete in P6
test("ability bar renders spell slots from snapshot spellSlots array", () => {
  assert.match(ui, /me\?\.spellSlots/);
  assert.match(ui, /slot\.classList\.toggle\("locked"/);
});

// legacy text guard — delete in P6
test("rune mode ability bar renders six spell slots", () => {
  assert.match(ui, /CFG\.SPELL_SLOT_COUNT/);
  assert.match(ui, /spellSlots/);
  assert.match(ui, /empty/);
});

// legacy text guard — delete in P6
test("spell slot hotkeys are configurable and persisted locally", () => {
  assert.match(input, /SPELL_SLOT_HOTKEY_STORAGE_KEY/);
  assert.match(input, /localStorage\.setItem\(SPELL_SLOT_HOTKEY_STORAGE_KEY/);
  assert.match(input, /setSpellSlotHotkey/);
  assert.match(ui, /hotkey-picker/);
});

// legacy text guard — delete in P6
test("host lobby exposes bot count and difficulty controls", () => {
  assert.match(html, /id="bot-count"/);
  assert.match(html, /id="bot-skill"/);
  assert.match(ui, /getBotSettings/);
});

// legacy text guard — delete in P6
test("host menu exposes arena world and land size controls", () => {
  assert.match(html, /id="arena-world"/);
  assert.match(html, /id="land-size"/);
  assert.match(ui, /getArenaSettings/);
});

// legacy text guard — delete in P6
test("index.html contains item-bar element", () => {
  assert.match(html, /id="item-bar"/, "index.html must have #item-bar");
});

// legacy text guard — delete in P6
test("online screen uses queue status instead of hosted room browser or host-online controls", () => {
  assert.match(html, /id="online-queue-status"/);
  assert.match(html, /id="btn-cancel-queue"/);
  assert.doesNotMatch(html, /id="btn-host-online"/);
  assert.doesNotMatch(html, /id="rooms-list"/);
  assert.doesNotMatch(ui, /renderRooms\(/);
});

// legacy text guard — delete in P6
test("item bar has a positioned CSS rule with pointer-events auto", () => {
  assert.match(css, /#item-bar\s*\{[\s\S]*?position:\s*fixed[\s\S]*?pointer-events:\s*auto/);
});
