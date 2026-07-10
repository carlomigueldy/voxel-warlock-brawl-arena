"""Spell icon renderer for the Blender/bpy asset pipeline (WS-B).

Builds a small voxel "sculpture" per spell (see icons_manifest.RECIPES) and
renders all of them to transparent 256x256 PNGs under one fixed camera/light
rig, so lighting never drifts between icons. Driven by `build.py`'s
`--what icons` branch; see scripts/blender/README.md for the pipeline's
general conventions (palette, "Col" vertex attr, determinism, no textures).

Design: each recipe paints onto a flat `Canvas2D` symbol grid using a small
set of stamp primitives (line/polyline/circle/diamond/triangle), then
`canvas_to_grid()` extrudes each symbol to its own height + palette shade:

    "."  dim/shadow    — low grounding cells (2 layers)
    "X"  base/dominant — main mass, this spell's primary color (6 layers)
    "O"  light         — raised highlight/energy core (10 layers)
    "*"  sparkle       — tiny bright accent, literal white (12 layers)
    "#"  dark accent   — slash marks / pupils / numerals, literal black (3)

Painting onto a flat grid rather than freehand 3D keeps 33 recipes tractable
while the *height* difference between symbols still reads as genuine 3D
relief under the tilted 3-point rig (taller cells catch more key/rim light),
giving the "strong silhouette, 2-3 value steps" look the launch art pass
wants without hand-placing individual voxels per spell.
"""

import math
import os

import bpy

import _compat
import voxel_lib

CANVAS_HALF = 8  # every icon is painted on the same -8..8 x -8..8 grid so
                  # the fixed camera frames all 33 identically.

LAYER_HEIGHTS = {
    ".": 1,
    "X": 2,
    "O": 3,
    "*": 4,
    "#": 1,
}

# Symbol -> palette name suffix appended to "spell_<id>"; None means the
# symbol always resolves to the same literal neutral regardless of spell.
_SUFFIX = {".": "_dim", "X": "", "O": "_light"}
_LITERAL = {"*": "white", "#": "black"}


def screen(h, v):
    """Convert a desired *on-screen* horizontal/vertical offset (right-
    positive, up-positive — how a human would sketch a glyph) into canvas
    coordinates, compensating for the rig's 45-deg camera yaw.

    Empirically verified (render a single voxel at canvas (5,0) and (0,5)
    under `_setup_rig`): canvas +x projects to screen down-right and canvas
    +y projects to screen up-right, i.e. screen_h = x+y and screen_v = y-x.
    Inverting: x = (h-v)/2, y = (h+v)/2. Without this, a canvas-space
    zigzag/diagonal can collapse into a single near-horizontal or
    near-vertical bar on screen — bit `lightning`, `homing`, and `drag` in
    the first pass, where hand-picked canvas coordinates *looked* like a
    zigzag on paper but two of the three segments happened to land on the
    same degenerate screen axis. Recipes with a directional/zigzag
    silhouette should build it in screen space via this helper rather than
    guessing canvas coordinates directly; purely radial/symmetric shapes
    (circles, rings, diamonds centered at their own origin) are unaffected
    and don't need it."""
    return (round((h - v) / 2), round((h + v) / 2))


def sv(x, y, scale=0.6):
    """Map an (x, y) anchor point lifted from a spell's 24x24 SVG glyph
    (src/spell-icons.js) into this module's canvas coordinates: recenter the
    SVG's (12, 12) origin to (0, 0) and flip Y (SVG y grows downward; the
    canvas' y grows toward the camera's "back"/top-of-frame). Recipes use
    this so their shapes stay traceable back to the hand-authored SVG
    silhouette they're echoing, even though they aren't exact vector traces."""
    return (round((x - 12) * scale), round((12 - y) * scale))


def _disk_offsets(r):
    ir = int(math.ceil(r))
    return [
        (dx, dy)
        for dx in range(-ir, ir + 1)
        for dy in range(-ir, ir + 1)
        if dx * dx + dy * dy <= r * r + 1e-6
    ]


class Canvas2D:
    """A flat symbol grid recipes paint onto. Later stamps overwrite earlier
    ones at the same cell — draw base shapes first, accents/highlights last."""

    def __init__(self, half_w=CANVAS_HALF, half_h=CANVAS_HALF):
        self.half_w = half_w
        self.half_h = half_h
        self.px = {}

    def set(self, x, y, sym):
        x, y = round(x), round(y)
        if abs(x) <= self.half_w and abs(y) <= self.half_h:
            self.px[(x, y)] = sym

    def line(self, x0, y0, x1, y1, sym, r=0.7):
        length = math.hypot(x1 - x0, y1 - y0)
        steps = max(1, int(length * 2))
        offsets = _disk_offsets(r)
        for i in range(steps + 1):
            t = i / steps
            cx = x0 + (x1 - x0) * t
            cy = y0 + (y1 - y0) * t
            icx, icy = round(cx), round(cy)
            for dx, dy in offsets:
                self.set(icx + dx, icy + dy, sym)

    def polyline(self, points, sym, r=0.7):
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            self.line(x0, y0, x1, y1, sym, r=r)

    def circle(self, cx, cy, r, sym, ring=False, ring_w=1.3):
        ir = int(math.ceil(r))
        for x in range(cx - ir, cx + ir + 1):
            for y in range(cy - ir, cy + ir + 1):
                d = math.hypot(x - cx, y - cy)
                if (ring and r - ring_w <= d <= r) or (not ring and d <= r):
                    self.set(x, y, sym)

    def diamond(self, cx, cy, r, sym):
        ir = int(math.ceil(r))
        for x in range(cx - ir, cx + ir + 1):
            for y in range(cy - ir, cy + ir + 1):
                if abs(x - cx) + abs(y - cy) <= r:
                    self.set(x, y, sym)

    def triangle(self, p0, p1, p2, sym):
        xs, ys = (p0[0], p1[0], p2[0]), (p0[1], p1[1], p2[1])
        x0, x1r = min(xs), max(xs)
        y0, y1r = min(ys), max(ys)

        def side(a, b, c):
            return (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1])

        for x in range(int(math.floor(x0)), int(math.ceil(x1r)) + 1):
            for y in range(int(math.floor(y0)), int(math.ceil(y1r)) + 1):
                pt = (x, y)
                d1, d2, d3 = side(pt, p0, p1), side(pt, p1, p2), side(pt, p2, p0)
                neg = d1 < 0 or d2 < 0 or d3 < 0
                pos = d1 > 0 or d2 > 0 or d3 > 0
                if not (neg and pos):
                    self.set(x, y, sym)

    def rect(self, x0, y0, x1, y1, sym):
        for x in range(min(x0, x1), max(x0, x1) + 1):
            for y in range(min(y0, y1), max(y0, y1) + 1):
                self.set(x, y, sym)


def canvas_to_grid(canvas, spell_id):
    """Extrude a painted Canvas2D into a VoxelGrid, resolving each symbol to
    its palette color (see module docstring) and height."""
    grid = voxel_lib.VoxelGrid()
    for (x, y), sym in canvas.px.items():
        color_name = _LITERAL.get(sym)
        if color_name is None:
            color_name = f"spell_{spell_id}{_SUFFIX[sym]}"
        height = LAYER_HEIGHTS[sym]
        grid.box(x, y, 0, x, y, height - 1, color_name)
    return grid


def _setup_rig(scene):
    """One fixed orthographic 3/4 top-down camera + 3-point light rig shared
    by every icon render, so lighting/framing never drifts across the set."""
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.resolution_x = 256
    scene.render.resolution_y = 256
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 100
    if hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = 32

    cam_data = bpy.data.cameras.new("icon_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.0
    cam_obj = bpy.data.objects.new("icon_cam", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = (1.55, -1.55, 1.75)
    cam_obj.rotation_euler = (math.radians(52), 0, math.radians(45))
    scene.camera = cam_obj

    def add_light(name, energy, loc, rot, shadow=True):
        ld = bpy.data.lights.new(name, type="SUN")
        ld.energy = energy
        ld.use_shadow = shadow
        lo = bpy.data.objects.new(name, ld)
        scene.collection.objects.link(lo)
        lo.location = loc
        lo.rotation_euler = rot
        return lo

    add_light("key", 3.0, (2, -2, 3), (math.radians(50), 0, math.radians(35)))
    # Fill + ambient are shadowless — they exist purely to keep recessed
    # "dim" cells next to taller neighbors from crushing to near-black on
    # whichever side face the key/rim suns don't reach; occluded fill lights
    # would just recreate the same problem.
    add_light("fill", 1.6, (-2, -1, 2), (math.radians(65), 0, math.radians(-55)), shadow=False)
    add_light("ambient", 1.0, (0, 0, 3), (math.radians(15), 0, math.radians(150)), shadow=False)
    add_light("rim", 1.8, (0, 2, 1.4), (math.radians(-35), 0, math.radians(180)))


def render_all(out_dir):
    import icons_manifest  # local import: only needed by this entrypoint

    _compat.reset_scene()
    scene = bpy.context.scene
    _setup_rig(scene)
    os.makedirs(out_dir, exist_ok=True)

    for spell_id, recipe_fn in icons_manifest.RECIPES.items():
        # Camera/lights stay put; only the mesh object is swapped per spell.
        for obj in list(bpy.data.objects):
            if obj.type == "MESH":
                bpy.data.objects.remove(obj, do_unlink=True)

        canvas = Canvas2D()
        recipe_fn(canvas)
        grid = canvas_to_grid(canvas, spell_id)
        voxel_lib.build_mesh(grid, f"icon_{spell_id}")

        out_path = os.path.join(out_dir, f"{spell_id}.png")
        scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
        print(f"[icons] wrote {out_path} ({len(grid.cells)} voxels)")
