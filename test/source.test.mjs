import assert from "node:assert";
import fs from "node:fs";
import { CFG } from "../src/config.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

console.log("Source integration checks:");

const main = fs.readFileSync("src/main.js", "utf8");
const ui = fs.readFileSync("src/ui.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("src/style.css", "utf8");

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

test("generated character asset URLs resolve relative to the character module", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  assert.match(character, /new URL\("\.\.\/assets\/warlock-player-rigged\.glb", import\.meta\.url\)\.href/);
  assert.match(character, /new URL\("\.\.\/assets\/warlock-player-walking\.glb", import\.meta\.url\)\.href/);
  assert.match(character, /new URL\("\.\.\/assets\/warlock-player-running\.glb", import\.meta\.url\)\.href/);
});

test("generated character model is scaled to the simulation player height", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  assert.match(character, /import \{ CFG \} from "\.\/config\.js";/);
  assert.match(character, /const TARGET_HEIGHT = CFG\.PLAYER_HEIGHT;/);
});

test("generated character size is measured from skinned mesh geometry, not setFromObject", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  // setFromObject mis-measures skinned meshes whose armature node carries a
  // tiny scale (0.01 here), producing a ~100x oversize. Size must come from the
  // skinned mesh geometry's own bounding box instead.
  assert.match(character, /computeBoundingBox\(\)/);
  assert.match(character, /\.boundingBox/);
  assert.doesNotMatch(character, /setFromObject/);
});

test("generated character model is bottom aligned after scaling", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  assert.match(character, /scene\.position\.y -= measured\.min\.y \* s/);
});

test("generated character tinting preserves single-material meshes", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  assert.match(character, /const wasArray = Array\.isArray\(o\.material\)/);
  assert.match(character, /o\.material = wasArray \? tinted : tinted\[0\]/);
});

test("generated character label height follows simulation player height", () => {
  const renderer = fs.readFileSync("src/renderer.js", "utf8");
  assert.match(renderer, /CFG\.PLAYER_HEIGHT \+ 0\.55/);
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

test("host lobby exposes bot count and difficulty controls", () => {
  assert.match(html, /id="bot-count"/);
  assert.match(html, /id="bot-skill"/);
  assert.match(ui, /getBotSettings/);
  assert.match(main, /sim\.setBotRoster/);
});

test("UI stylesheet defines voxel low-poly design system tokens", () => {
  assert.match(css, /--stone-dark:/);
  assert.match(css, /--lava-core:/);
  assert.match(css, /--mana-crystal:/);
  assert.match(css, /--voxel-cut:/);
  assert.match(css, /clip-path: polygon/);
  assert.match(css, /linear-gradient\(135deg/);
});

test("UI markup applies voxel component primitives across menu lobby and HUD", () => {
  assert.match(html, /class="panel voxel-card menu-card"/);
  assert.match(html, /class="panel voxel-card lobby-card"/);
  assert.match(html, /class="lobby-left voxel-card shard-card"/);
  assert.match(html, /class="lobby-right voxel-card shard-card"/);
  assert.match(html, /class="join-box voxel-control-cluster"/);
  assert.match(html, /class="voxel-field"/);
  assert.match(html, /id="hud-top" class="hud-slab"/);
  assert.match(html, /id="scoreboard" class="hud-slab scoreboard-card"/);
  assert.match(html, /id="charge-wrap" class="hud-slab charge-meter"/);
});

test("UI stylesheet styles reusable voxel component primitives", () => {
  assert.match(css, /\.voxel-card/);
  assert.match(css, /\.voxel-field/);
  assert.match(css, /\.voxel-toggle/);
  assert.match(css, /\.hud-slab/);
  assert.match(css, /\.shard-card/);
  assert.match(css, /\.voxel-control-cluster/);
  assert.match(css, /--facet-top:/);
  assert.match(css, /--facet-bottom:/);
});

test("every voxel component class used in markup is defined in the stylesheet", () => {
  const used = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const cls of m[1].split(/\s+/)) {
      if (/^(voxel-|rune-|shard-|hud-slab|scoreboard-card|charge-meter|menu-card|lobby-card)/.test(cls)) used.add(cls);
    }
  }
  for (const cls of used) {
    assert.match(css, new RegExp("\\." + cls.replace(/[-]/g, "\\-") + "\\b"), `missing CSS for .${cls}`);
  }
});

test("UI honors reduced-motion preference", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("UI exposes eight selectable redesign variants", () => {
  for (const v of [3, 4, 5, 6, 7, 8, 9, 10]) {
    assert.match(html, new RegExp(`theme-v${v}`));
    assert.match(html, new RegExp(`v=${v}`));
  }
  assert.match(html, /URLSearchParams\(location\.search\)/);
});

test("UI stylesheet defines distinct voxel redesign variants", () => {
  for (const v of [3, 4, 5, 6, 7, 8, 9, 10]) assert.match(css, new RegExp(`\\.theme-v${v}`));
  assert.match(css, /Obsidian Forge/);
  assert.match(css, /Arcane Crystal/);
  assert.match(css, /Goblin Workshop/);
  assert.match(css, /Frost Citadel/);
  assert.match(css, /Elven Grove/);
  assert.match(css, /Necromancer Crypt/);
  assert.match(css, /Dragon Hoard/);
  assert.match(css, /Celestial Sanctum/);
});

test("UI exposes four component design-system variants via ds param", () => {
  assert.match(html, /URLSearchParams\(location\.search\)[\s\S]*get\("ds"\)/);
  for (const d of [1, 2, 3, 4]) {
    assert.match(html, new RegExp(`ds-v${d}`));
    assert.match(html, new RegExp(`ds=${d}`));
  }
});

test("design-system variants restructure components, not just colors", () => {
  for (const d of [1, 2, 3, 4]) {
    assert.match(css, new RegExp(`\\.ds-v${d} \\.voxel-card`));
    assert.match(css, new RegExp(`\\.ds-v${d} \\.voxel-button`));
    assert.match(css, new RegExp(`\\.ds-v${d} \\.voxel-field`));
    assert.match(css, new RegExp(`\\.ds-v${d} \\.hud-slab`));
    assert.match(css, new RegExp(`\\.ds-v${d} \\.ability-slot`));
  }
  assert.match(css, /Beveled Blocks/);
  assert.match(css, /Carved Tablet/);
  assert.match(css, /Crystal Facet/);
  assert.match(css, /Pixel Frame/);
});

test("variant pickers preserve the other design axis after the DOM exists", () => {
  assert.match(html, /addEventListener\("DOMContentLoaded"/);
  assert.match(html, /data-set-v/);
  assert.match(html, /data-set-ds/);
});

console.log(`\n${passed} source checks passed.`);
