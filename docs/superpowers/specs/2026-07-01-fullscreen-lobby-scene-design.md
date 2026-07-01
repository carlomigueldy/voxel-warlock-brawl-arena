# Fullscreen Lobby Scene — "The Staging Grounds"

## Context

The Lobby currently renders as a floating rounded `.panel.lobby-panel` modal
(max-width ~1140px, max-height 90vh, scrollable) centered on the ember
background. With the new in-lobby match config it reads like a settings dialog,
not a scene. We want a **fullscreen cinematic ready-room**: the pre-match staging
grounds you stand in while choosing the battleground and mustering warlocks.

This is a **compositional/visual** change only. No gameplay, networking, sim, or
wire-protocol changes. Element ids and JS behavior are preserved; the map hero,
arena cards, host/client config, player list, bot controls, and Start button all
keep working exactly as today.

## Design system (reuse — do NOT reinvent)

Established "Arcane Voxel Forge" system in `src/style.css :root`:
- Palette tokens: `--void #0a0814`, `--obsidian`, `--ember #ff5a3c`,
  `--arcane #6c4cff`, `--gold #ffd23c`, `--cyan`, `--pink`, `--rune`, `--text`,
  `--muted`, `--line`, `--line-strong`.
- Type: `--font-display` (Press Start 2P) for big moments used with restraint;
  `--font-ui` (Chakra Petch) for body/labels.
- Existing ambient: `.ember-field` + `.overlay::after` voxel grid drift — keep as
  the scene backdrop.

## The composition (fullscreen — no card container)

Replace the centered `.panel` box for `#lobby` with a full-bleed layout that
fills the viewport. `#lobby.overlay` stays `position:fixed; inset:0` but its child
is now a full-height scene grid, not a bounded panel.

Three vertical zones on a full-height flex/grid column:

1. **Top HUD rail** — left: `STAGING GROUNDS` eyebrow + `LOBBY` wordmark
   (compact, inline, HUD-like — not a big centered brand). Right: the **room
   code as a war banner** (prominent pixel-type, letterspaced, framed) with
   Copy Code / Copy Invite Link + QR (QR can collapse into a small popover or a
   compact tile so it doesn't dominate). Thin hairline rule under the rail.

2. **Center stage — three columns** (`minmax` grid), full available height:
   - **Left rail — WARLOCKS**: the muster roster (`#player-list`), host badge,
     and host-only bot muster (`#bot-controls`). Quiet, HUD-framed.
   - **Center — BATTLEGROUND VIEWPORT (signature)**: the `#map-hero` enlarged to
     a big cinematic framed viewport — HUD corner brackets, a faint scanline
     sheen overlay, arena name in `--font-display`, hazard telegraphed. Directly
     below it, the arena selector (`#arena-world-ui` cards) laid out as a
     horizontal **filmstrip** (host) — scroll/wrap on small widths. The scene
     background subtly tints toward the selected hazard color.
   - **Right rail — MATCH SETUP**: host-only live controls (`#land-size-ui`,
     `#map-objects-ui`, mobs toggle) OR, for clients, the read-only
     `#lobby-client-config` summary. HUD-framed, quiet.

3. **Bottom launch bar** — full width: left shows a **muster count**
   ("N warlocks mustered" / status via `#lobby-status`), right is the big
   `#btn-start` **START BRAWL** (host-only). Hairline rule above.

ASCII:
```
◹ STAGING GROUNDS · LOBBY            ROOM ▸ [ K H D 3 9 M ]  Copy · Invite · QR
──────────────────────────────────────────────────────────────────────────────
 WARLOCKS        │      ▛▀              ▀▜                    │  MATCH SETUP
 ● HostWarlock   │      ▏  battleground viewport  ▕           │  Arena world
 ● GuestWarlock  │      ▏  Outer Ring · Arcane Abyss ▕        │  ▸ filmstrip
 host: bot muster│      ▙▄              ▄▟                    │  Land · Objects
                 │   ◟ arena filmstrip: ◻ ◻ ◻ ◻ ◻ ◞          │  Mobs ●━
──────────────────────────────────────────────────────────────────────────────
 2 WARLOCKS MUSTERED                                 ▶  START BRAWL
```

## Signature: the battleground viewport
- Enlarge `#map-hero` into the visual centerpiece (min-height responsive, e.g.
  `clamp(220px, 34vh, 420px)`), framed like a HUD screen: thin `--line-strong`
  border, inset bezel, **corner brackets** (pseudo-elements), a subtle animated
  **scanline** sheen (respect `prefers-reduced-motion`).
- Arena name uses `--font-display`; hazard name in the hazard color.
- On arena change, crossfade the hero and re-tint a scene-level hazard accent
  (a CSS var, e.g. `--stage-hazard`, set by `renderMapHero`/`_selectArena`,
  driving a soft radial glow behind the viewport).

## Motion
- Entry: staggered reveal of the three zones (top rail → rails/stage → launch
  bar), short and disciplined. Reuse `--ease-spring`.
- Ambient embers + grid drift continue.
- Battleground scanline + arena-swap crossfade.
- All motion gated behind `prefers-reduced-motion: reduce`.

## Files to change
- `index.html` — restructure the `#lobby` subtree into the fullscreen scene
  (top rail / three-column stage / launch bar). **Preserve every id**:
  `#room-code #btn-copy-code #btn-copy-link #qr #map-hero #arena-world-ui
  #arena-world #land-size-ui #land-size #map-objects-ui #mobs-toggle
  #mobs-toggle-ui #lobby-host-config #lobby-client-config #player-list
  #bot-controls #bot-count-ui #bot-count #bot-count-value #bot-skill-ui
  #bot-skill #btn-start #lobby-status`. Keep aria roles/labels.
- `src/style.css` — new fullscreen `#lobby` scene styles (top rail, stage grid,
  battleground viewport, filmstrip, launch bar); the `.lobby-panel` /
  `.lobby-grid` modal rules are replaced. Full responsive stack for mobile
  (single column, viewport scroll allowed on small screens), visible
  `:focus-visible` rings, `prefers-reduced-motion` overrides.
- `src/ui.js` — only if needed for the scene: a small **muster count** render in
  the launch bar (derive from the player list already rendered by
  `renderPlayerList`), and set the `--stage-hazard` scene tint when the hero
  updates (extend existing `renderMapHero`). Keep `showLobby`'s host/client
  visibility logic. Do NOT change networking or the config sync.

## Non-goals
- No changes to `src/main.js`, `src/sim.js`, `src/config.js`, `src/net.js`.
- No new fonts, images, or build tooling. Pure CSS/SVG.
- No change to the map-selection feature's data flow (already shipped).

## Quality bar (frontend-design)
Fullscreen must feel like a scene, not a stretched form: generous margins, HUD
framing (brackets/hairlines), the battleground viewport as the one bold element,
everything else quiet. Responsive to mobile. Keyboard focus visible. Reduced
motion respected. Copy in the interface's voice ("2 warlocks mustered", "Waiting
for host…", "Start Brawl").

## Verification
1. `npm test` green.
2. Dev server on 11525; screenshot host lobby (default + a hazard-swapped arena)
   and client lobby at desktop (1280) and mobile (390) widths. Confirm: no
   floating modal box; battleground viewport is the centerpiece; host controls
   vs client read-only summary correct; Start bar host-only; nothing clipped;
   arena swap re-tints; reduced-motion kills animation.
