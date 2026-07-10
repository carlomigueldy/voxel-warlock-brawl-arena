"""Per-spell voxel-icon recipes for scripts/blender/icons.py (WS-B).

`RECIPES` maps every id in src/config.js CFG.SPELLS (SPELL_ORDER) to a
function `(canvas) -> None` that paints that spell's glyph onto a fresh
`icons.Canvas2D` using the stamp primitives (line/polyline/circle/diamond/
triangle/rect). Each recipe is a loose sketch of the matching hand-authored
SVG in src/spell-icons.js (via `icons.sv()`, which remaps SVG anchor points
into canvas space) — not an exact vector trace, but chosen to keep the same
motif/direction language so the PNG icon and the SVG fallback read as "the
same spell" at a glance.

Keep recipes here (not inline in icons.py) so a single spell's glyph can be
tweaked without touching the shared rig/canvas machinery.
"""

import math

from icons import sv, screen


def _fireball(c):
    c.triangle((6, 0), (0, 4), (0, -4), "X")  # bold comet head, apex forward (+x)
    c.triangle((5, 0), (1, 2), (1, -2), "O")  # bright core
    c.line(0, 3, -6, 4, ".", r=1.3)   # diverging trail streaks (rocket exhaust)
    c.line(0, -3, -6, -4, ".", r=1.3)
    c.line(0, 0, -7, 0, ".", r=0.8)
    c.circle(6, 0, 0.9, "*")


def _lightning(c):
    # ONE bold Z-shaped bolt, built in *screen* space via icons.screen() —
    # this rig's 45-deg camera yaw maps canvas +x to screen down-right and
    # canvas +y to screen up-right, so hand-picked canvas coordinates that
    # "look like a zigzag on paper" can land on the same degenerate screen
    # axis and collapse into a single bar (that's what happened here and in
    # `_homing`/`_drag` on the first pass). screen(h, v) takes right/up
    # offsets like a human sketch and compensates for the yaw.
    bolt = [screen(1, 7), screen(-2, 2), screen(1, -1), screen(-2, -7)]
    c.polyline(bolt, "#", r=1.9)   # dark backing silhouette for contrast
    c.polyline(bolt, "X", r=1.15)  # main bolt stroke
    c.polyline(bolt, "O", r=0.45)  # bright core line
    c.circle(*screen(1, 7), 0.9, "*")


def _boomerang(c):
    pts = [sv(5, 17), sv(11, 8), sv(19, 11)]
    c.polyline(pts, "X", r=1.3)
    c.polyline(pts, "O", r=0.6)
    c.circle(*sv(11, 8), 0.8, "*")


def _homing(c):
    # Built in screen space (see `_lightning`) so the trail actually reads as
    # a diagonal chase toward the target ring instead of collapsing flat.
    trail = [screen(-7, -6), screen(-3, -3), screen(0, 0)]
    c.polyline(trail, ".", r=1.1)                          # tracking trail
    c.triangle(trail[-1], screen(2, 1), screen(1, -1), "X")  # chasing bolt head
    rx, ry = screen(5, 5)
    c.circle(rx, ry, 3.0, "X", ring=True, ring_w=1.4)  # target-lock ring
    c.circle(rx, ry, 1.3, "O")                         # locked destination cube
    c.line(rx, ry + 4, rx, ry + 2.3, ".", r=0.7)        # crosshair ticks
    c.line(rx + 4, ry, rx + 2.3, ry, ".", r=0.7)
    c.circle(rx, ry, 0.5, "*")


def _fireSpray(c):
    for dx in (-3, 0, 3):
        c.polyline([(0, -7), (round(dx * 0.4), -2), (dx, 4)], "X", r=1.0)
    c.circle(0, -7, 1.1, "O")
    c.polyline([(-5, 2), (0, 4), (5, 2)], ".", r=0.7)


def _bouncer(c):
    c.polyline([(-6, -5), (-2, 4), (2, -4), (6, 5)], "X", r=1.1)
    c.circle(-2, 4, 0.8, "O")
    c.circle(2, -4, 0.8, "O")
    c.circle(6, 5, 1.1, "*")


def _splitter(c):
    c.circle(0, 0, 1.4, "O")
    for ang in (90, 90 - 72, 90 - 144, 90 + 72, 90 + 144):
        x2 = round(6 * math.cos(math.radians(ang)))
        y2 = round(6 * math.sin(math.radians(ang)))
        c.line(0, 0, x2, y2, "X", r=0.9)
    c.circle(0, 0, 0.5, "*")


def _meteor(c):
    # One fused mass (rock + impact wedge touching/overlapping at its base)
    # instead of the previous two disconnected clusters, plus a couple of
    # short trailing streak dots rather than a whole separate dashed line.
    c.circle(3, 1, 2.6, "X")                     # the falling rock
    c.circle(3, 1, 1.3, "O")                     # bright facet highlight
    c.triangle((0, -1), (4, -1), (2, -4), "X")   # impact wedge, fused to the rock's base
    c.circle(2, -4, 0.9, "O")                    # impact flash at the wedge tip
    c.circle(1, 4, 0.6, ".")                     # short motion-streak trail
    c.circle(0, 5, 0.5, ".")


def _teleport(c):
    c.diamond(-5, 3, 2.2, "X")
    c.diamond(-5, 3, 1.1, "O")
    c.diamond(5, -3, 2.6, "X")
    c.diamond(5, -3, 1.4, "O")
    c.line(-3, 2, 3, -2, ".", r=0.6)
    c.circle(5, -3, 0.5, "*")


def _thrust(c):
    c.line(-6, 0, 2, 0, "X", r=1.3)
    c.triangle((2, 3), (2, -3), (6, 0), "X")
    c.circle(6, 0, 2.2, ".", ring=True, ring_w=1.0)
    c.circle(6, 0, 0.7, "*")


def _swap(c):
    c.circle(-4, 0, 2.4, "X")
    c.circle(4, 0, 2.4, "X")
    c.circle(-4, 0, 1.2, "O")
    c.circle(4, 0, 1.2, "O")
    c.polyline([(-2, 2), (0, 4), (2, 2)], ".", r=0.7)
    c.polyline([(2, -2), (0, -4), (-2, -2)], ".", r=0.7)


def _windWalk(c):
    c.line(-5, 0, 4, 0, "X", r=1.1)
    c.triangle((4, 2), (4, -2), (7, 0), "X")
    c.polyline([(-7, 4), (-3, 5), (1, 3)], ".", r=0.7)
    c.polyline([(-7, -4), (-3, -5), (1, -3)], ".", r=0.7)
    c.circle(-6, 0, 0.6, ".")


def _rush(c):
    c.polyline([sv(7, 5), sv(14, 12), sv(7, 19)], "X", r=1.2)
    c.polyline([sv(13, 5), sv(20, 12), sv(13, 19)], "X", r=1.2)
    c.circle(*sv(20, 12), 3.2, ".", ring=True, ring_w=1.0)  # resist-shield ring
    for y in (8, 12, 16):
        c.line(*sv(1, y), *sv(6, y), ".", r=0.7)


def _drain(c):
    c.circle(-5, 5, 1.3, "O")
    c.circle(5, -5, 1.7, "X")
    c.polyline([(-5, 5), (-2, 3), (0, 0), (2, -2), (5, -5)], ".", r=0.7)
    c.circle(5, -5, 0.6, "*")


def _gravity(c):
    c.circle(0, 0, 6, ".", ring=True, ring_w=0.8)
    c.circle(0, 0, 4, "X", ring=True, ring_w=1.0)
    c.circle(0, 0, 2, "O", ring=True, ring_w=1.0)
    c.circle(0, 0, 0.8, "*")
    for ang in (30, 150, 270):
        x = round(6.5 * math.cos(math.radians(ang)))
        y = round(6.5 * math.sin(math.radians(ang)))
        c.circle(x, y, 0.6, ".")


def _link(c):
    c.circle(-6, 0, 1.6, "X")
    c.circle(6, 0, 1.6, "X")
    c.line(-4.5, 0, 4.5, 0, "O", r=0.6)
    c.circle(-2, 1, 0.5, ".")
    c.circle(2, -1, 0.5, ".")


def _disable(c):
    c.circle(0, 0, 6, "X", ring=True, ring_w=1.4)
    c.circle(0, 0, 3, ".", ring=True, ring_w=1.0)
    c.line(-5, -5, 5, 5, "#", r=1.4)
    c.circle(0, 0, 0.6, "*")


def _shield(c):
    c.rect(-5, 0, 5, 4, "X")
    c.triangle((-5, 0), (5, 0), (0, -7), "X")
    c.line(0, 3, 0, -4, "O", r=0.6)
    c.line(-3, 0, 3, 0, "O", r=0.6)
    c.circle(4, 5, 0.6, "*")


def _timeShift(c):
    c.circle(0, 0, 6.0, "X", ring=True, ring_w=1.6)
    c.circle(0, 0, 7.0, ".", ring=True, ring_w=1.0)
    c.line(0, 0, 0, 4, "O", r=0.7)
    c.line(0, 0, 3, 0, "O", r=0.7)
    c.triangle((-7, -2), (-3, -2), (-5, 2), ".")
    c.circle(0, 0, 0.7, "*")


def _pocketWatch(c):
    c.circle(0, 0, 6.0, "X", ring=True, ring_w=1.6)
    c.line(0, 0, 0, 4, "O", r=0.7)
    c.line(0, 0, 3, 0, "O", r=0.7)
    c.circle(0, 7, 1.0, ".", ring=True, ring_w=0.8)
    c.circle(0, 0, 0.6, "*")


def _projectile(c):
    c.triangle((7, 0), (1, 3), (1, -3), "X")
    c.triangle((7, 0), (3, 1.5), (3, -1.5), "O")
    for y in (-2, 0, 2):
        c.line(-7, y, -3, y, ".", r=0.5)


def _target(c):
    c.circle(0, 0, 5, "X", ring=True, ring_w=1.3)
    c.diamond(0, 0, 3, "O")
    for cx, cy in ((-6, -6), (6, -6), (-6, 6), (6, 6)):
        sx = 1 if cx < 0 else -1
        sy = 1 if cy < 0 else -1
        c.line(cx, cy, cx + 2 * sx, cy, ".", r=0.6)
        c.line(cx, cy, cx, cy + 2 * sy, ".", r=0.6)
    c.circle(0, 0, 0.6, "*")


def _explode(c):
    c.circle(0, 0, 2.6, "O")
    for ang in range(0, 360, 45):
        x2 = round(7 * math.cos(math.radians(ang)))
        y2 = round(7 * math.sin(math.radians(ang)))
        c.line(0, 0, x2, y2, "X", r=1.0)
    c.circle(0, 0, 1.1, "*")


def _stun(c):
    c.polyline([(2, 7), (6, 3), (4, -1), (7, -5)], "X", r=1.1)
    c.polyline([(-2, -7), (-6, -3), (-4, 1), (-7, 5)], "X", r=1.1)
    c.circle(0, 0, 1.1, "O")
    c.circle(0, 0, 0.5, "*")


def _push(c):
    # 3 separated radiating chevrons (closest = brightest/boldest) rather
    # than the SVG's overlapping smooth arcs, which voxelized into a single
    # blob at this scale — a clean "shove wave" read needs daylight between them.
    c.polyline([(-2, 2), (1, 0), (-2, -2)], "O", r=1.1)
    c.polyline([(-4, 4), (0, 0), (-4, -4)], "X", r=1.1)
    c.polyline([(-6, 6), (-1, 0), (-6, -6)], ".", r=1.0)
    c.circle(-7, 0, 0.9, "X")


def _pull(c):
    # (6,6)->(-5,-4): same-sign diagonal, matching the drag/disable recipes —
    # the camera's 45-deg yaw compresses the *opposite*-sign diagonal (see
    # `_drag` below) into a near-vertical read, which flattened this shape's
    # ring+arrowhead detail into an illegible thin bar on the first pass.
    c.circle(6, 6, 1.6, ".", ring=True, ring_w=0.9)  # hook loop around distant target
    c.polyline([(6, 6), (2, 2), (-2, -2), (-5, -4)], "X", r=1.2)  # pull line toward self
    c.triangle((-5, -4), (-2, -3), (-3, -6), "O")  # arrowhead pointing toward self


def _drag(c):
    # Was a thin line studded with along-path dots, which voxelized into a
    # toothed comb rather than reading as a tow rope. Clean single-width
    # taut line + a real hook ring at the far end + a solid handle at self.
    c.line(5, 5, -4, -5, "X", r=1.0)                  # taut tow line
    c.circle(5, 5, 1.6, ".", ring=True, ring_w=0.9)   # hook loop latched onto the target
    c.circle(5, 5, 0.6, "O")                          # hook clasp glint
    c.circle(-4, -5, 1.5, "X")                        # anchor/handle at the near end (self)
    c.circle(-4, -5, 0.7, "O")


def _vacuum(c):
    c.circle(0, 0, 1.2, "O")
    for base_ang in (0, 120, 240):
        pts = []
        for i, rad in enumerate((6, 4, 2)):
            ang = base_ang + i * 35
            pts.append((round(rad * math.cos(math.radians(ang))), round(rad * math.sin(math.radians(ang)))))
        c.polyline(pts, "X", r=0.9)
    c.circle(-5, 4, 0.4, ".")
    c.circle(5, 3, 0.4, ".")
    c.circle(3, -5, 0.4, ".")


def _heal(c):
    c.diamond(0, 0, 6, ".")
    c.rect(-1, -4, 1, 4, "X")
    c.rect(-4, -1, 4, 1, "X")
    c.rect(-1, -1, 1, 1, "O")


def _invisible(c):
    # Eye-with-a-slash — a universally readable "hidden/unseen" motif,
    # replacing the previous abstract dagger shape that didn't clearly say
    # "invisible." A flattened eyelid-triangle pair (canvas or screen space)
    # turned out to be a thin elongated diagonal sliver either way — the
    # same "toothy bar" failure mode as the first-pass `drag`/`pull`/`link`
    # shapes. A compact ring is symmetric under this rig's camera rotation
    # and sidesteps it; proportions mirror `_disable` (ring radius/slash
    # length/thickness), which reads cleanly at this same rig and scale.
    c.circle(0, 0, 6, "X", ring=True, ring_w=1.4)  # eye socket / lid ring
    c.circle(0, 0, 2.4, "O")                        # iris
    c.circle(0, 0, 1.0, "#")                        # pupil
    c.line(-5, -5, 5, 5, "#", r=1.4)  # bold dark slash — "unseen"
    c.circle(5, 5, 0.7, "*")


def _speed(c):
    c.polyline([sv(7, 5), sv(14, 12), sv(7, 19)], "X", r=1.0)
    c.polyline([sv(13, 5), sv(20, 12), sv(13, 19)], "X", r=1.0)
    for y in (8, 12, 16):
        c.line(*sv(1, y), *sv(6, y), ".", r=0.6)
    c.circle(*sv(20, 12), 0.6, "*")


def _blink(c):
    c.triangle((-6, 3), (-2, 4), (-4, -2), "X")
    c.triangle((3, 3), (7, 4), (5, -2), "X")
    c.line(-2, 0, 3, 0, "O", r=0.6)
    c.circle(6, 3, 0.5, "*")


def _summon(c):
    c.circle(0, -1, 5.5, "X", ring=True, ring_w=1.3)
    c.circle(0, -1, 3.0, ".", ring=True, ring_w=0.8)
    c.diamond(0, 4, 1.4, "O")
    c.circle(0, -1, 0.6, "*")


RECIPES = {
    "fireball": _fireball,
    "lightning": _lightning,
    "boomerang": _boomerang,
    "homing": _homing,
    "fireSpray": _fireSpray,
    "bouncer": _bouncer,
    "splitter": _splitter,
    "meteor": _meteor,
    "teleport": _teleport,
    "thrust": _thrust,
    "swap": _swap,
    "windWalk": _windWalk,
    "rush": _rush,
    "drain": _drain,
    "gravity": _gravity,
    "link": _link,
    "disable": _disable,
    "shield": _shield,
    "timeShift": _timeShift,
    "pocketWatch": _pocketWatch,
    "projectile": _projectile,
    "target": _target,
    "explode": _explode,
    "stun": _stun,
    "push": _push,
    "pull": _pull,
    "drag": _drag,
    "vacuum": _vacuum,
    "heal": _heal,
    "invisible": _invisible,
    "speed": _speed,
    "blink": _blink,
    "summon": _summon,
}
