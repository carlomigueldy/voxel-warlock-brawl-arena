"""Driver for the Blender/bpy procedural asset pipeline.

Usage (via the single entrypoint, which picks the right Python runner):
    scripts/blender/run.sh --what {test,props,icons,all}

`--what test` builds a small demo voxel crystal + pillar and exports it to
scripts/blender/out/test-crystal.glb, proving venv/bpy (or the
`blender --background` fallback), voxel_lib, palette, and the GLB exporter
all work together. `props` and `icons` are stubs for now.
"""

import argparse
import os
import random
import sys

# `blender --background --python build.py` does NOT add this script's own
# directory to sys.path the way plain `python build.py` does — without this,
# `import _compat` fails only under the Blender-binary fallback runner.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _compat
import voxel_lib

_compat.reset_scene()


def build_test():
    """Small demo voxel crystal atop a stone pillar — an end-to-end pipeline
    smoke test, not a real game asset."""
    rng = random.Random(1234)  # seeded — never use unseeded `random` here
    grid = voxel_lib.VoxelGrid()

    # Pillar: a stone column with a wider plinth at its base.
    grid.box(0, 0, 0, 2, 2, 7, "stone")
    grid.box(-1, -1, 0, 3, 3, 0, "stone_light")

    # Crystal: a tapering shard on top, accent color chosen deterministically
    # per layer from the seeded rng (demonstrates the seeded-randomness rule
    # every pipeline script must follow for reproducible builds).
    accents = ["arcane", "hazard_void", "hazard_void_shard"]
    top = 8
    for i, radius in enumerate([2, 2, 1, 1, 0]):
        z = top + i
        color = accents[rng.randrange(len(accents))]
        grid.sphere(1, 1, z, radius, color)

    grid.mirror_x()

    obj = voxel_lib.build_mesh(grid, "test_crystal")
    out_dir = _compat.ensure_output_dir()
    out_path = os.path.join(out_dir, "test-crystal.glb")
    voxel_lib.export_glb(obj, out_path)
    print(f"[build.py] wrote {out_path}")


def build_props():
    import props_gen  # local import: keeps this stub's import list minimal until used

    props_gen.generate_all()


def build_icons():
    import icons  # local import: keeps this stub's import list minimal until used

    out_dir = os.path.join(_compat.REPO_ROOT, "assets", "icons", "spells")
    icons.render_all(out_dir)
    print(f"[build.py] wrote spell icons to {out_dir}")


def build_decimate(argv):
    """WS-I asset-diet pass: `--what decimate --in <glb> [--out ...] [--ratio
    ...]` shrinks one rigged GLB in place (mesh decimate + texture
    recompress). See decimate_glb.py's module docstring for why both matter.
    `argv` is whatever CLI args followed `--what decimate` — decimate_glb.py
    owns its own argparse for those, separate from this file's `--what`."""
    import decimate_glb  # local import: keeps this stub's import list minimal until used

    decimate_glb.main(argv)


def main():
    parser = argparse.ArgumentParser(description="Voxel Warlock Brawl Arena asset pipeline")
    parser.add_argument("--what", choices=["test", "props", "icons", "all", "decimate"], required=True)
    # parse_known_args (not parse_args): "decimate" carries its own --in/--out/
    # --ratio/etc. args that this parser doesn't know about and shouldn't
    # validate — they're forwarded to decimate_glb.main() below untouched.
    args, remaining = parser.parse_known_args(_compat.get_args())

    if args.what in ("test", "all"):
        build_test()
    if args.what in ("props", "all"):
        build_props()
    if args.what in ("icons", "all"):
        build_icons()
    if args.what == "decimate":
        build_decimate(remaining)


if __name__ == "__main__":
    main()
