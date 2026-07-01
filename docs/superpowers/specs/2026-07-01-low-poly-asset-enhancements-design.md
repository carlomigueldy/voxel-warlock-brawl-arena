# Low-Poly Asset Enhancements — Design

Date: 2026-07-01
Branch: `feat/low-poly-asset-enhancements` (standalone, non-epic; PR → `main`)

## Goal

Convert every **non-character** 3D asset in Voxel Warlock Brawl Arena to a
stylized **low-poly faceted** look with **flat shading** and **deliberately
increased polygon detail**, rebuilt **procedurally from Three.js geometry**
(no external GLB loading for non-character assets). Character models are
explicitly excluded.

## Scope

**In scope (all non-character rendered geometry):**

- Projectiles (fireball, boomerang, homing, bouncer, splitter, disable, meteor)
- Ability rune + item drops (all `ITEM_SHAPES`)
- Mobs (stoneGiant, stormingVortex, giantDwarf, fireElemental, minion)
- Props / obstacles (tree, stone, column, debris, wall, boulder, deadGiant,
  dragonBones)
- Terrain (platform, plateau, ramp) — instanced, perf-conscious
- Transient VFX (burst, storm clouds, meteor rock)

**Out of scope (excluded):**

- `assets/characters/*.glb`, `assets/warlock-player-*.glb`
- `src/character.js` (GLB rig loading, `buildCharacterInstance`)
- `buildWarlock()` voxel fallback in `voxel.js` (character)

## Decisions

1. **Meshy GLBs:** files stay on disk under `assets/meshy/` but the loading
   path is removed entirely. `MESHY_ASSETS` export, the renderer's
   `_loadMeshyAsset` / `_installMeshyAsset` / `_installMeshyMeteor` GLB
   overlay, the renderer's `GLTFLoader` import, and the `loader.js` fetch
   preload are all removed. `test/source.test.mjs` is updated to drop the
   `MESHY_ASSETS` contract and instead assert procedural-only builds.
2. **Aesthetic:** flat-shaded faceted polyhedra
   (`IcosahedronGeometry`/`DodecahedronGeometry`/`OctahedronGeometry`,
   `ConeGeometry`/`CylinderGeometry` with modest segment counts) replacing
   plain 6-face `BoxGeometry`. Lit via `MeshLambertMaterial({ flatShading: true })`;
   glowing cores via emissive Lambert; halos/auras stay unlit translucent.
   "Increased polycount" = more facets per shape than a box, enough to read
   curved/organic form, while staying well within real-time budgets.
3. **Shared helper:** a new `src/lowpoly.js` exports one faceted-geometry
   recipe set (`facetedRock`, `facetedCrystal`, `facetedOrb`, `facetedCone`,
   `facetedCylinder`, `facetedShard`, `facetedTrunk`, …) reused by
   `voxel.js`, `props.js`, and `renderer.js` so the aesthetic is consistent.

## Architecture

- `src/lowpoly.js` (new) — pure builders returning `THREE.Mesh`/`Group`,
  all `flatShading: true`, with `castShadow`/`receiveShadow` set. No imports
  of game config (keeps it a leaf module).
- `src/voxel.js` — `box()`/`glowBox()`/`auraBox()` kept for the voxel
  warlock (character, excluded); non-character builders rewritten to call
  into `lowpoly.js`. Mob builders use faceted torsos/heads/limbs.
- `src/props.js` — `box()` local helper replaced by `lowpoly.js` calls;
  each obstacle gets faceted geometry (conical tree canopy, cylindrical
  trunk, polyhedron boulders, etc.).
- `src/renderer.js` — bolts/runes/meteors built procedurally only; the
  Meshy cache, GLTFLoader, and overlay plumbing deleted.
- `src/loader.js` — meshy fetch preload removed; character preload stays.
- `test/source.test.mjs` — the "renderer declares Meshy GLB assets" test
  becomes "renderer builds projectiles/runes procedurally (no GLB)".

## Risks / Guards

- Terrain uses `InstancedMesh` — keep it instanced; only swap the source
  geometry to a faceted variant with modest segment counts so instance count
  × face count stays GPU-friendly.
- `source.test.mjs:363` already forbids GLB/meshy refs in `props.js` — keep
  it true.
- Tests are node-only (no DOM/Three.js render); they assert source text, so
  rewritten builders must keep the exported names and call sites the tests
  check (`buildBolt`, `buildRune`, `buildMeteor`, `buildItemDrop`,
  `buildMobByType`, `PROP_BUILDERS`).

## Verification

- `npm ci`
- `python3 -m json.tool feature_list.json > /dev/null`
- `npm test`
- Manual: `npm run dev` on port 30065, visually confirm faceted look.
