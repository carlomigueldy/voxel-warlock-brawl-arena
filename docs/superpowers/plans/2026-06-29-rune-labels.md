# Rune Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each ability rune's full spell name above the rune so players can identify and compete for specific pickups.

**Architecture:** Keep rune snapshots unchanged because they already include `spell`. The renderer imports `SPELLS`, resolves `SPELLS[r.spell].name`, and attaches a reusable sprite label to each rune group when it is created.

**Tech Stack:** Browser-native ES modules, Three.js sprites/canvas textures, existing Node source tests.

## Global Constraints

- Do not change gameplay rules or rune pickup/destruction behavior.
- Do not add a build step or new runtime dependency.
- Preserve existing procedural rune fallback and Meshy GLB rune loading.
- Use full spell names from `SPELLS`, not raw spell ids.

---

### Task 1: Render Spell Name Labels On Rune Pickups

**Files:**
- Modify: `test/source.test.mjs`
- Modify: `src/renderer.js`

**Interfaces:**
- Consumes: rune snapshots shaped as `{ id, spell, x, z, c }` from `Simulation.snapshot()`.
- Consumes: `SPELLS` exported by `src/config.js` with entries like `{ name: "Meteor" }`.
- Produces: rune groups with a sprite label created by `_makeLabel(name, color, y)` and stored as `g.userData.label`.
- Produces: Meshy asset installation that re-adds `group.userData.label` after `group.clear()` so labels remain visible after GLBs load.

- [ ] **Step 1: Write the failing source test**

Add this test near the existing Meshy rune/source renderer tests in `test/source.test.mjs`:

```js
test("renderer labels ability runes with spell names", () => {
  assert.match(renderer, /import \{ CFG, SPELLS \} from "\.\/config\.js";/);
  assert.match(renderer, /SPELLS\[r\.spell\]\?\.name/);
  assert.match(renderer, /_makeLabel\(name, r\.c \|\| 0xffffff, 1\.65\)/);
  assert.match(renderer, /userData\.label/);
  assert.match(renderer, /const label = group\.userData\.label/);
  assert.match(renderer, /if \(label\) group\.add\(label\)/);
});
```

- [ ] **Step 2: Run the failing source test**

Run: `node test/source.test.mjs`

Expected: FAIL for `renderer labels ability runes with spell names` because `renderer.js` does not import `SPELLS` or attach rune labels yet.

- [ ] **Step 3: Implement minimal renderer changes**

Update the config import at the top of `src/renderer.js`:

```js
import { CFG, SPELLS } from "./config.js";
```

Inside the `if (!g)` block for `snapshot.runes`, after `g = buildRune(...)` and before adding the Meshy asset, add:

```js
const name = SPELLS[r.spell]?.name || r.spell || "Rune";
const label = this._makeLabel(name, r.c || 0xffffff, 1.65);
g.add(label);
g.userData.label = label;
```

Inside `_installMeshyAsset`, preserve labels before replacing procedural children:

```js
const label = group.userData.label;
group.clear();
group.add(asset);
if (label) group.add(label);
```

- [ ] **Step 4: Run focused verification**

Run: `node test/source.test.mjs`

Expected: all source checks pass, including `renderer labels ability runes with spell names`.

- [ ] **Step 5: Run full verification**

Run: `npm test`

Expected: all simulation, spellbook, and source checks pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add test/source.test.mjs src/renderer.js docs/superpowers/plans/2026-06-29-rune-labels.md
git commit -m "Add labels to ability runes"
```

Expected: one commit containing the test, renderer update, and this plan.
