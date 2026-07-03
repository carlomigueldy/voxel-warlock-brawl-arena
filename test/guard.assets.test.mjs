// Source guards for the asset-loading layer: audio.js, loader.js, mobModel.ts.
// Split from test/source.test.mjs (#103) by which source file each guard reads.
import { test } from "vitest";
import assert from "node:assert";
import fs from "node:fs";

console.log("Source guards (assets) checks:");

// legacy text guard — delete in P6
test("projectile clash events trigger dedicated VFX and SFX (audio half)", () => {
  const audio = fs.readFileSync("src/audio.ts", "utf8");
  assert.match(audio, /case "projectileClash"/);
});

// legacy text guard — delete in P6
test("loader preloads only character GLBs (no Meshy fetch priming)", () => {
  const loader = fs.readFileSync("src/loader.js", "utf8");
  assert.doesNotMatch(loader, /MESHY_ASSETS|meshy|assets\/meshy\//);
  assert.match(loader, /loadCharacterTemplate/);
});

// legacy text guard — delete in P6
// mobModel.js was ported to mobModel.ts (value-identical — TS annotations
// only) by #141; voxel.js/renderer.js still import it unchanged via the
// "./mobModel.js" specifier (Vite/vitest resolve .js -> .ts transparently).
test("mobModel.ts is the sole owner of GLB loading for the 4 big mobs", () => {
  const mobModel = fs.readFileSync("src/mobModel.ts", "utf8");
  assert.match(mobModel, /GLTFLoader/);
  assert.match(mobModel, /assets\/mobs\//);
});
