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

    # --- src/config.js CFG.SPELLS[*].color (WS-B spell icon glyphs) ---
    # Each spell gets 3 named shades used by scripts/blender/icons.py's
    # Canvas2D symbol->color mapping: base "spell_<id>" (dominant hue, exact
    # CFG.SPELLS[id].color), "_dim" (~50% value, grounding/shadow cells) and
    # "_light" (blended ~35% toward white, raised highlight cells). Keep these
    # in sync with src/config.js SPELLS if a spell's color changes.
    "spell_fireball": "#ff5a1e",
    "spell_fireball_dim": "#7f2d0f",
    "spell_fireball_light": "#ff936c",
    "spell_lightning": "#9fe6ff",
    "spell_lightning_dim": "#4f737f",
    "spell_lightning_light": "#c0eeff",
    "spell_boomerang": "#ffe14c",
    "spell_boomerang_dim": "#7f7026",
    "spell_boomerang_light": "#ffeb8a",
    "spell_homing": "#c04cff",
    "spell_homing_dim": "#60267f",
    "spell_homing_light": "#d68aff",
    "spell_fireSpray": "#ff7a2e",
    "spell_fireSpray_dim": "#7f3d17",
    "spell_fireSpray_light": "#ffa877",
    "spell_bouncer": "#4cff9c",
    "spell_bouncer_dim": "#267f4e",
    "spell_bouncer_light": "#8affbe",
    "spell_splitter": "#ff4ca8",
    "spell_splitter_dim": "#7f2654",
    "spell_splitter_light": "#ff8ac6",
    "spell_meteor": "#ff3a1e",
    "spell_meteor_dim": "#7f1d0f",
    "spell_meteor_light": "#ff7e6c",
    "spell_teleport": "#3ad6ff",
    "spell_teleport_dim": "#1d6b7f",
    "spell_teleport_light": "#7ee4ff",
    "spell_thrust": "#ff6a44",
    "spell_thrust_dim": "#7f3522",
    "spell_thrust_light": "#ff9e85",
    "spell_swap": "#e066ff",
    "spell_swap_dim": "#70337f",
    "spell_swap_light": "#ea9bff",
    "spell_windWalk": "#8ff2c9",
    "spell_windWalk_dim": "#477964",
    "spell_windWalk_light": "#b6f6db",
    "spell_rush": "#ffa63c",
    "spell_rush_dim": "#7f531e",
    "spell_rush_light": "#ffc580",
    "spell_drain": "#aa2f6b",
    "spell_drain_dim": "#551735",
    "spell_drain_light": "#c7779e",
    "spell_gravity": "#4a2fb0",
    "spell_gravity_dim": "#251758",
    "spell_gravity_light": "#8977cb",
    "spell_link": "#2fd9c4",
    "spell_link_dim": "#176c62",
    "spell_link_light": "#77e6d8",
    "spell_disable": "#bbbbbb",
    "spell_disable_dim": "#5d5d5d",
    "spell_disable_light": "#d2d2d2",
    "spell_shield": "#7fe0ff",
    "spell_shield_dim": "#3f707f",
    "spell_shield_light": "#abeaff",
    "spell_timeShift": "#c9a227",
    "spell_timeShift_dim": "#645113",
    "spell_timeShift_light": "#dbc272",
    "spell_pocketWatch": "#ffe14c",
    "spell_pocketWatch_dim": "#7f7026",
    "spell_pocketWatch_light": "#ffeb8a",
    "spell_projectile": "#6fc0ff",
    "spell_projectile_dim": "#37607f",
    "spell_projectile_light": "#a1d6ff",
    "spell_target": "#9c2bff",
    "spell_target_dim": "#4e157f",
    "spell_target_light": "#be75ff",
    "spell_explode": "#ff6a1e",
    "spell_explode_dim": "#7f350f",
    "spell_explode_light": "#ff9e6c",
    "spell_stun": "#ffe14c",
    "spell_stun_dim": "#7f7026",
    "spell_stun_light": "#ffeb8a",
    "spell_push": "#aef0ff",
    "spell_push_dim": "#57787f",
    "spell_push_light": "#caf5ff",
    "spell_pull": "#8fffc4",
    "spell_pull_dim": "#477f62",
    "spell_pull_light": "#b6ffd8",
    "spell_drag": "#4cff9c",
    "spell_drag_dim": "#267f4e",
    "spell_drag_light": "#8affbe",
    "spell_vacuum": "#6c4cff",
    "spell_vacuum_dim": "#36267f",
    "spell_vacuum_light": "#9f8aff",
    "spell_heal": "#7cff8a",
    "spell_heal_dim": "#3e7f45",
    "spell_heal_light": "#a9ffb2",
    "spell_invisible": "#445577",
    "spell_invisible_dim": "#222a3b",
    "spell_invisible_light": "#8590a6",
    "spell_speed": "#ffd23c",
    "spell_speed_dim": "#7f691e",
    "spell_speed_light": "#ffe180",
    "spell_blink": "#66ccff",
    "spell_blink_dim": "#33667f",
    "spell_blink_light": "#9bddff",
    "spell_summon": "#9c7bff",
    "spell_summon_dim": "#4e3d7f",
    "spell_summon_light": "#bea9ff",
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
