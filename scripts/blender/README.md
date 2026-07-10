# Blender/bpy procedural asset pipeline

Generates voxel-style game assets (props, icons) as GLBs using Blender's
Python API (`bpy`), with no manual modeling. There is no game build step —
everything here writes static files that get committed or referenced
directly.

## Running it

```bash
bash scripts/blender/env.sh          # one-time (idempotent) bootstrap
bash scripts/blender/run.sh --what test   # or: npm run gen:assets / gen:icons / gen:props
```

`run.sh` is the single entrypoint. It picks whichever runner actually has a
working `bpy`:

1. **Preferred:** `scripts/blender/.venv` (python3.11 + a pip-installed `bpy`
   wheel), created by `env.sh`.
2. **Fallback:** `blender --background --python scripts/blender/build.py -- <args>`,
   using the system Blender install. This is a fully supported path, not an
   error — `bpy` wheels don't exist for every Python/OS/arch combination, and
   `env.sh` always exits 0 even when it can't install one, specifically so
   this fallback is exercised instead of failing the caller.

Both runners execute the exact same `build.py` / `voxel_lib.py` / `palette.py`
code — `scripts/blender/_compat.py` is what makes that possible (see below).

## Conventions every prop/icon script must follow

- **1 grid unit = 0.1 world units.** `VoxelGrid` coordinates are plain
  integers; `voxel_lib.build_mesh(grid, name, unit=0.1)` is what scales them
  into world space. This is deliberately finer than the game's own coarse
  `CFG.VOXEL = 1` world-grid unit (see `src/config.js`) — a small prop or
  icon built on a 10-30 voxel grid ends up roughly 1-3 world units across,
  which reads as "chunky voxel art" rather than single oversized blocks.
  Don't reuse `CFG.VOXEL` for this; it's a different scale for a different
  purpose (world tile size vs. prop model detail).
- **Colors always come from `palette.PALETTE`**, which mirrors
  `src/config.js` (`CFG.ARENA_HAZARDS[*].color/.glow`) and `src/style.css`
  (`:root` design tokens) by hand. If the game's palette changes, update
  `palette.py` to match — don't invent new hex values in a build script.
  `palette.color_rgba(name)` raises `KeyError` (listing valid names) rather
  than silently defaulting, so typos fail loud.
- **Vertex colors live on a color attribute named `"Col"`**
  (`FLOAT_COLOR`, `CORNER` domain). This is what three.js's `GLTFLoader`
  picks up as `COLOR_0`. Don't rename it, and don't add a second color
  attribute — `voxel_lib.export_glb()` exports specifically `"Col"` by name.
- **Determinism is mandatory.** Never call the unseeded `random` module.
  Every script that needs randomness (jitter, color variation, layout) must
  accept or construct a `random.Random(seed)` and thread it through
  explicitly. GLB export itself may embed non-deterministic bytes (e.g. a
  generator/timestamp string in the `asset` chunk) — that's expected and
  fine; what must be deterministic is the *mesh content* (vertex positions,
  colors, indices) for a given seed.
- **No textures, no Draco.** `voxel_lib.build_mesh()` assigns one shared
  `VoxelVertexColor` material (Principled BSDF fed by the `"Col"` attribute)
  to every object, so GLBs stay tiny and texture-free.
  `voxel_lib.export_glb()` always disables Draco compression — vertex counts
  here are small enough that Draco's overhead isn't worth the decode cost in
  the browser.
- **Flat shading, not smooth.** Voxel cubes should look like cubes, not
  faceted spheres — `build_mesh()` sets `poly.use_smooth = False` on every
  face.
- **Interior faces are culled.** `build_mesh()` skips any face shared
  between two occupied cells, so touching voxels don't generate hidden
  internal geometry. This is a per-cube check, not full greedy meshing — fine
  for the small prop/icon scale this pipeline targets.

## File map

| File | Purpose |
| --- | --- |
| `env.sh` | Idempotent bootstrap: creates `.venv` (python3.11), installs `bpy` (pinned `5.1.2` first, then newest compatible), or explains the fallback. Always exits 0. |
| `_compat.py` | Shim imported by every script. `get_args()` normalizes argv across the venv-python and `blender --background --python … -- …` runners; `reset_scene()` clears Blender's scene state; `OUTPUT_ROOT`/`REPO_ROOT` resolve relative to the repo root (found via the `package.json` marker) regardless of the runner's CWD. |
| `palette.py` | `PALETTE` dict of named hex colors mirroring the game; `hex_to_rgba()` / `color_rgba()` convert to linear-space RGBA floats for vertex colors (sRGB -> linear gamma correction by default). |
| `voxel_lib.py` | `VoxelGrid` (sparse int grid with `set`/`box`/`line`/`sphere`/`mirror_x`), `build_mesh()` (grid -> single merged flat-shaded mesh object with per-face `"Col"` vertex colors), `export_glb()` (GLB export: vertex colors, no Draco, no textures/lights/cameras/extras/animations). |
| `build.py` | CLI driver: `--what {test,props,icons,all}`. `test` builds a demo crystal+pillar to prove the pipeline; `props`/`icons` are stubs today (print "not yet implemented", exit 0) for WS-B/WS-C to fill in. |
| `run.sh` | Single entrypoint; picks venv-bpy or falls back to `blender --background`. |
| `.venv/`, `out/` | Gitignored — local venv and generated GLBs. Nothing under `out/` is committed from here; a script that needs its output tracked should copy it into the actual asset directory the game reads from. |

## Adding a new prop/icon script

1. `import _compat, palette, voxel_lib` (plain top-level imports — the
   script's own directory is on `sys.path` automatically under both runners).
2. Call `_compat.reset_scene()` once at the top if the script may run inside
   a longer-lived session.
3. Build a `VoxelGrid`, call `voxel_lib.build_mesh(grid, "some_name")`, then
   `voxel_lib.export_glb(obj, path)` with `path` under `_compat.OUTPUT_ROOT`
   (or wherever the game's asset loader expects it — check with the
   propModel/icon loader owner before changing that path).
4. Wire it into `build.py`'s `--what` dispatch (replacing the `props`/`icons`
   stub bodies) rather than adding a new top-level script, so `run.sh` stays
   the single entrypoint.
