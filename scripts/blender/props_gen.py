"""Dungeon prop GLB builders (WS-C).

Generates the shared prop kit (pillar, torch, banner, ...) plus five
per-theme accent props, and exports them to assets/props/<name>.glb — the
directory the game actually reads from (unlike scripts/blender/out/, which is
gitignored per README.md's file map).

Coordinate convention (matches build.py's build_test): x/y are the horizontal
footprint, z is height. VoxelGrid.set(x, y, z, color); build_mesh() then
scales by `unit` and export_glb() applies export_yup=True so Blender's Z
becomes three.js's Y at export time.

Run via: bash scripts/blender/run.sh --what props  (or `npm run gen:props`).
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

import _compat
import voxel_lib

PROPS_OUTPUT_DIR = os.path.join(_compat.REPO_ROOT, "assets", "props")


def ensure_props_dir():
    os.makedirs(PROPS_OUTPUT_DIR, exist_ok=True)
    return PROPS_OUTPUT_DIR


# ---------------------------------------------------------------------------
# Geometry helpers — VoxelGrid only offers box/line/sphere, so tapered
# columns/discs used by several props are built here from repeated discs.
# ---------------------------------------------------------------------------

def fill_disc(grid, cx, cy, z, r, color):
    """Fill a rough circular footprint at height layer z."""
    if r <= 0:
        return
    ir = int(round(r))
    for x in range(cx - ir, cx + ir + 1):
        for y in range(cy - ir, cy + ir + 1):
            dx, dy = x - cx, y - cy
            if dx * dx + dy * dy <= r * r + 0.6:
                grid.set(x, y, z, color)


def fill_square(grid, cx, cy, z, half, color):
    """Fill a square footprint (half-extent `half`) at height layer z."""
    half = max(0, int(round(half)))
    grid.box(cx - half, cy - half, z, cx + half, cy + half, z, color)


def taper_column(grid, cx, cy, z0, height, r0, r1, color, rng=None, jitter=0.0, min_r=0.1, jitter_stride=3):
    """A rough round column from z0 to z0+height, radius interpolating r0->r1.
    `jitter` (world-grid units) adds irregularity via the seeded rng for
    organic silhouettes (rock spires, roots) — never the unseeded random.
    The jitter offset is redrawn only every `jitter_stride` layers (and held
    for the layers in between) rather than every single layer: per-layer
    jitter makes every ring's radius round to a different integer, which
    turns each boundary into extra exposed side faces (voxel_lib.build_mesh()
    doesn't merge shared vertices across faces, so face count is what drives
    GLB size — see the 50KB/prop budget in README.md)."""
    h = max(1, int(round(height)))
    j = 0.0
    for i in range(h + 1):
        if jitter and rng is not None and i % jitter_stride == 0:
            j = rng.uniform(-jitter, jitter)
        t = i / h
        r = r0 + (r1 - r0) * t + j
        fill_disc(grid, cx, cy, z0 + i, max(min_r, r), color)


def taper_square_column(grid, cx, cy, z0, height, half0, half1, color, rng=None, jitter=0.0, min_half=0.1, jitter_stride=3):
    """Square-footprint counterpart of taper_column, for flat-faced obelisks.
    See taper_column's docstring for why jitter is held across `jitter_stride`
    layers instead of redrawn every layer."""
    h = max(1, int(round(height)))
    j = 0.0
    for i in range(h + 1):
        if jitter and rng is not None and i % jitter_stride == 0:
            j = rng.uniform(-jitter, jitter)
        t = i / h
        half = half0 + (half1 - half0) * t + j
        fill_square(grid, cx, cy, z0 + i, max(min_half, half), color)


def recolor_ring_accent(grid, z_values, from_color, to_color, rng, chance=0.5):
    """Recolor a random subset of cells at the given z layers whose color is
    `from_color` — used for glowing crack/vein/band accents on spires and
    obelisks. Deterministic: dict iteration order follows insertion order, and
    the rng draws are consumed in that fixed order."""
    zset = set(z_values)
    for key in list(grid.cells.keys()):
        x, y, z = key
        if z in zset and grid.cells[key] == from_color and rng.random() < chance:
            grid.cells[key] = to_color


# ---------------------------------------------------------------------------
# Shared kit (9 props) — reused across every theme.
# ---------------------------------------------------------------------------

def build_pillar(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    fill_disc(grid, 0, 0, 0, 2.6, "stone")
    fill_disc(grid, 0, 0, 1, 2.2, "stone")
    taper_column(grid, 0, 0, 2, 11, 1.6, 1.6, "stone_light", rng=rng, jitter=0.1)
    fill_disc(grid, 0, 0, 13, 2.0, "stone")
    fill_disc(grid, 0, 0, 14, 2.4, "stone_light")
    return grid


def build_broken_pillar(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    fill_disc(grid, 0, 0, 0, 2.4, "stone")
    fill_disc(grid, 0, 0, 1, 2.0, "stone")
    shaft_h = 7
    taper_column(grid, 0, 0, 2, shaft_h, 1.5, 1.4, "stone_light", rng=rng, jitter=0.15)
    top_z = 2 + shaft_h
    # Jagged broken top: randomly knock out voxels from the top layer.
    for key in list(grid.cells.keys()):
        x, y, z = key
        if z >= top_z - 1 and rng.random() < 0.35:
            del grid.cells[key]
    # Rubble scattered at the base.
    for i in range(3):
        ang = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(2.8, 4.2)
        bx = int(round(math.cos(ang) * dist))
        by = int(round(math.sin(ang) * dist))
        r = rng.uniform(0.6, 1.0)
        fill_disc(grid, bx, by, 0, r, "stone")
    return grid


def build_arch(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    leg_h = 6
    leg_r = 1
    span = 4
    for lx in (-span, span):
        grid.box(lx - leg_r, -leg_r, 0, lx + leg_r, leg_r, leg_h, "stone")
        grid.box(lx - leg_r, -leg_r, leg_h, lx + leg_r, leg_r, leg_h, "stone_light")
    beam_th = 2
    half_span = span + leg_r
    # Curve is quantized to 2-wide x-steps (rather than every unit) so the
    # lintel's underside doesn't stair-step at every column — fewer distinct
    # z-boundaries means fewer exposed side faces for the same silhouette.
    step = 2
    for xi in range(-half_span, half_span + 1, step):
        tnorm = xi / half_span
        curve = 4 * (1 - tnorm * tnorm)
        z_top = int(round(leg_h + 1 + curve))
        z_bot = z_top - beam_th
        x_hi = min(xi + step - 1, half_span)
        grid.box(xi, -leg_r, z_bot, x_hi, leg_r, z_top, "stone_light")
    return grid


def build_torch(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    taper_column(grid, 0, 0, 0, 14, 0.7, 0.5, "stone", rng=rng, jitter=0.05)
    grid.sphere(0, 0, 15, 1.6, "hazard_lava_ember")
    grid.sphere(0, 0, 16, 1.1, "gold")
    return grid


def build_brazier(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    taper_column(grid, 0, 0, 0, 6, 0.6, 0.6, "stone", rng=rng, jitter=0.05)
    fill_disc(grid, 0, 0, 7, 2.6, "stone_light")
    fill_disc(grid, 0, 0, 8, 2.4, "stone_light")
    # Hollow the bowl's centre so it reads as an open basin holding embers.
    for key in list(grid.cells.keys()):
        x, y, z = key
        if z == 8 and x * x + y * y <= 1.2 * 1.2:
            del grid.cells[key]
    grid.sphere(0, 0, 8, 1.2, "hazard_lava_ember")
    grid.sphere(0, 0, 9, 0.8, "gold")
    return grid


def build_banner(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    pole_h = 17
    taper_column(grid, 0, 0, 0, pole_h, 0.4, 0.4, "stone", rng=rng, jitter=0.04)
    cloth_z0, cloth_z1 = 8, 16
    grid.box(0, 1, cloth_z0, 0, 5, cloth_z1, "arcane")
    grid.box(0, 1, cloth_z1 - 1, 0, 5, cloth_z1, "gold")
    # Triangular notch cut from the bottom-outer corner of the cloth.
    for key in list(grid.cells.keys()):
        x, y, z = key
        if grid.cells.get(key) == "arcane":
            depth = z - cloth_z0
            cut = max(0, 3 - depth)
            if depth < 3 and y >= 5 - cut:
                del grid.cells[key]
    return grid


def build_rune_stone(seed):
    # Fully fixed geometry (no jitter needed for a carved rune pedestal); seed
    # is accepted only so every builder shares the same `fn(seed)` signature.
    grid = voxel_lib.VoxelGrid()
    grid.box(-3, -3, 0, 3, 3, 1, "stone")
    grid.box(-2, -2, 2, 2, 2, 2, "stone_light")
    for (dx, dy) in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]:
        grid.set(dx, dy, 3, "rune")
    grid.set(0, 0, 4, "rune")
    return grid


def build_crystal_cluster(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    fill_disc(grid, 0, 0, 0, 2.4, "stone")
    spikes = [
        (0, 0, 10, 1.6, "arcane"),
        (2, 1, 7, 1.1, "cyan"),
        (-2, 1, 8, 1.2, "arcane"),
        (1, -2, 6, 0.9, "cyan"),
        (-1, -2, 5, 0.8, "pink"),
    ]
    for (cx, cy, h, r0, color) in spikes:
        taper_column(grid, cx, cy, 1, h, r0, 0.1, color, rng=rng, jitter=0.1, min_r=0.1)
    return grid


def build_rubble(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    for i in range(6):
        ang = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(0, 3.2)
        cx = int(round(math.cos(ang) * dist))
        cy = int(round(math.sin(ang) * dist))
        h = rng.uniform(1, 2.6)
        r = rng.uniform(0.7, 1.5)
        color = rng.choice(["stone", "stone_light", "hazard_rocks"])
        fill_disc(grid, cx, cy, 0, r, color)
        if h > 1.4:
            fill_disc(grid, cx, cy, 1, r * 0.6, color)
    return grid


# ---------------------------------------------------------------------------
# Theme variants (5 props) — one distinctive accent per hazard theme, reusing
# the same kit vocabulary (tapered columns / discs / accent recoloring).
# ---------------------------------------------------------------------------

def build_lava_obsidian_spire(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    fill_disc(grid, 0, 0, 0, 2.2, "black")
    taper_column(grid, 0, 0, 1, 14, 1.8, 0.3, "obsidian", rng=rng, jitter=0.15, min_r=0.3)
    recolor_ring_accent(grid, range(3, 14, 3), "obsidian", "hazard_lava_ember", rng, chance=0.45)
    grid.sphere(0, 0, 15, 0.6, "hazard_lava")
    return grid


def build_ocean_coral_pillar(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    fill_disc(grid, 0, 0, 0, 1.9, "stone")
    taper_column(grid, 0, 0, 1, 10, 1.3, 1.3, "stone_light", rng=rng, jitter=0.08)
    for i in range(6):
        z = rng.randint(2, 10)
        ang = rng.uniform(0, 2 * math.pi)
        r = 1.3 + 0.5
        bx = int(round(math.cos(ang) * r))
        by = int(round(math.sin(ang) * r))
        color = rng.choice(["hazard_ocean", "hazard_ocean_spray", "hazard_ocean_glow"])
        grid.sphere(bx, by, z, rng.uniform(0.5, 0.8), color)
    fill_disc(grid, 0, 0, 11, 1.1, "hazard_ocean_glow")
    return grid


def build_swamp_root_arch(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    leg_h = 7
    span = 4
    for lx in (-span, span):
        taper_column(grid, lx, 0, 0, leg_h, 1.1, 0.8, "hazard_swamp", rng=rng, jitter=0.25, min_r=0.5, jitter_stride=2)
    half_span = span + 1
    for x in range(-half_span, half_span + 1):
        tnorm = x / half_span
        curve = 3 * (1 - tnorm * tnorm)
        z_top = leg_h + curve
        z_bot = z_top - 2
        grid.box(x, -1, int(round(z_bot)), x, 1, int(round(z_top)), "hazard_swamp")
    for i in range(2):
        x = rng.randint(-half_span, half_span)
        z = rng.randint(leg_h - 2, leg_h + 3)
        grid.sphere(x, 0, z, 0.5, "hazard_swamp_bubble")
    return grid


def build_rocks_monolith(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    fill_disc(grid, 0, 0, 0, 2.0, "hazard_rocks")
    taper_column(grid, 0, 0, 1, 13, 1.6, 0.7, "hazard_rocks", rng=rng, jitter=0.25, min_r=0.5)
    for i in range(3):
        ang = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(1.6, 2.6)
        x = int(round(math.cos(ang) * dist))
        y = int(round(math.sin(ang) * dist))
        fill_disc(grid, x, y, 0, rng.uniform(0.5, 0.8), "hazard_rocks_dust")
    grid.sphere(0, 0, 14, 0.7, "hazard_rocks_glow")
    return grid


def build_void_obelisk(seed):
    rng = random.Random(seed)
    grid = voxel_lib.VoxelGrid()
    fill_square(grid, 0, 0, 0, 2, "obsidian")
    taper_square_column(grid, 0, 0, 1, 13, 1.6, 0.2, "hazard_void", rng=rng, jitter=0.08, min_half=0.2)
    recolor_ring_accent(grid, (4, 9), "hazard_void", "hazard_void_shard", rng, chance=0.6)
    grid.sphere(0, 0, 14, 0.6, "hazard_void_glow")
    grid.sphere(0, 0, 15, 0.4, "hazard_void_shard")
    return grid


# ---------------------------------------------------------------------------
# Registry — (name, seed, builder). Seeds are fixed per name (not index-based)
# so reordering this list never changes another prop's geometry.
# ---------------------------------------------------------------------------

ENTRIES = [
    ("pillar",               101, build_pillar),
    ("broken-pillar",        102, build_broken_pillar),
    ("arch",                 103, build_arch),
    ("torch",                104, build_torch),
    ("brazier",              105, build_brazier),
    ("banner",               106, build_banner),
    ("rune-stone",           107, build_rune_stone),
    ("crystal-cluster",      108, build_crystal_cluster),
    ("rubble",               109, build_rubble),
    ("lava-obsidian-spire",  201, build_lava_obsidian_spire),
    ("ocean-coral-pillar",   202, build_ocean_coral_pillar),
    ("swamp-root-arch",      203, build_swamp_root_arch),
    ("rocks-monolith",       204, build_rocks_monolith),
    ("void-obelisk",         205, build_void_obelisk),
]


def render_preview():
    """Best-effort contact-sheet render of every prop side by side, so the
    look can be spot-checked without opening Blender. Never fails the whole
    `gen:props` run — a headless env without a working Eevee backend just
    skips this (caller wraps it in try/except)."""
    _compat.reset_scene()
    cols = 5
    spacing = 4.0
    rows = (len(ENTRIES) + cols - 1) // cols

    for i, (name, seed, builder) in enumerate(ENTRIES):
        grid = builder(seed)
        obj = voxel_lib.build_mesh(grid, f"preview_{name.replace('-', '_')}")
        col = i % cols
        row = i // cols
        obj.location = (col * spacing, row * spacing, 0)

    scene = bpy.context.scene
    content_w = (cols - 1) * spacing + 3.0
    content_h = (rows - 1) * spacing + 3.0
    cx = (cols - 1) * spacing / 2
    cy = (rows - 1) * spacing / 2
    span = max(content_w, content_h)

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = span * 1.05
    cam_obj = bpy.data.objects.new("PreviewCam", cam_data)
    cam_obj.location = (cx, cy - span * 0.35, span * 0.42)
    cam_obj.rotation_euler = (0.85, 0, 0)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    sun_data = bpy.data.lights.new("PreviewSun", type="SUN")
    sun_data.energy = 6.0
    sun_obj = bpy.data.objects.new("PreviewSun", sun_data)
    sun_obj.rotation_euler = (0.9, 0.3, 0.6)
    scene.collection.objects.link(sun_obj)

    # Flat ambient fill so the shadowed sides of props aren't crushed to
    # black — this is just a spot-check render, not in-game lighting.
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs[0].default_value = (0.35, 0.35, 0.4, 1.0)
        bg.inputs[1].default_value = 1.2
    scene.world = world

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = int(1600 * rows / cols) + 150
    scene.render.image_settings.file_format = "PNG"
    out_path = os.path.join(_compat.ensure_output_dir(), "props-preview.png")
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    return out_path


def generate_all():
    out_dir = ensure_props_dir()
    written = []
    for name, seed, builder in ENTRIES:
        _compat.reset_scene()
        grid = builder(seed)
        obj = voxel_lib.build_mesh(grid, name.replace("-", "_"))
        out_path = os.path.join(out_dir, f"{name}.glb")
        voxel_lib.export_glb(obj, out_path)
        written.append(out_path)
        print(f"[props_gen] wrote {out_path}")

    try:
        preview_path = render_preview()
        print(f"[props_gen] wrote preview {preview_path}")
    except Exception as e:  # pragma: no cover - best-effort only
        print(f"[props_gen] preview render skipped: {e}")

    return written


if __name__ == "__main__":
    generate_all()
