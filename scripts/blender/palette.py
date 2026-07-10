"""Shared color palette for the Blender/bpy asset pipeline.

Hexes are mirrored by hand from the two sources of truth in the game itself —
keep this file in sync when those change:

  - src/config.js       CFG.ARENA_HAZARDS[*].color / .glow  (hazard theme colors)
  - src/style.css       :root design tokens (--void, --ember, --arcane, ...)

Do not import either file at runtime: config.js/style.css are ES modules /
CSS meant for the browser, not something bpy's Python can parse, so the
values are copied here as plain hex strings instead.
"""

PALETTE = {
    # --- src/style.css :root design tokens ---
    "void": "#0a0814",
    "obsidian": "#16112e",
    "panel": "#181433",
    "panel_2": "#120d28",
    "slot": "#0f0c22",
    "ember": "#ff5a3c",
    "arcane": "#6c4cff",
    "rune": "#7cff5a",
    "gold": "#ffd23c",
    "pink": "#ff4ca8",
    "cyan": "#4cc9ff",
    "text": "#ece9ff",
    "muted": "#9a93c7",

    # --- src/config.js CFG.ARENA_HAZARDS (base color / glow per hazard theme) ---
    "hazard_lava": "#ff3a1e",
    "hazard_lava_glow": "#ff3a1e",
    "hazard_lava_ember": "#ff8a3c",
    "hazard_ocean": "#1f7fd6",
    "hazard_ocean_glow": "#2a6fd0",
    "hazard_ocean_spray": "#bfe8ff",
    "hazard_swamp": "#4f7a2a",
    "hazard_swamp_glow": "#86d040",
    "hazard_swamp_bubble": "#b6f05a",
    "hazard_rocks": "#6a5a52",
    "hazard_rocks_glow": "#3a2a2a",
    "hazard_rocks_dust": "#9a8a7a",
    "hazard_void": "#b24cff",
    "hazard_void_glow": "#c04cff",
    "hazard_void_shard": "#d79cff",

    # --- Generic neutrals useful for voxel art (not from a specific token) ---
    "black": "#000000",
    "white": "#ffffff",
    "stone": "#3a3548",
    "stone_light": "#57516b",
}


def hex_to_rgba(hex_str, alpha=1.0, gamma_correct=True):
    """Convert a '#rrggbb' or '#rgb' hex string to an (r, g, b, a) float tuple.

    Blender vertex color attributes (FLOAT_COLOR) are stored in linear space
    for correct rendering/export, while the hex values above are sRGB (as
    authored in CSS/config.js). `gamma_correct=True` (default) applies the
    sRGB -> linear conversion so voxel colors match what you see in the
    browser; pass False to get the raw sRGB floats unconverted.
    """
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        raise ValueError(f"Invalid hex color: {hex_str!r}")

    r = int(h[0:2], 16) / 255.0
    g = int(h[2:4], 16) / 255.0
    b = int(h[4:6], 16) / 255.0

    if gamma_correct:
        def srgb_to_linear(c):
            return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

        r, g, b = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)

    return (r, g, b, alpha)


def color_rgba(name, alpha=1.0, gamma_correct=True):
    """Look up a named palette color and convert it. Raises KeyError with the
    available names if `name` isn't in PALETTE (fail loud, not silently black)."""
    if name not in PALETTE:
        raise KeyError(f"Unknown palette color {name!r}. Available: {sorted(PALETTE)}")
    return hex_to_rgba(PALETTE[name], alpha=alpha, gamma_correct=gamma_correct)
