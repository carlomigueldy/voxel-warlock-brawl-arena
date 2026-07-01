# Lobby Map Selection & Config — Design

## Context

Today the host configures the match **before** creating a room: arena world,
land size, and map objects live in a menu tab labeled **"Settings"** (misleading
— these are per-match game settings, not app settings), and the **Mob spawns**
toggle lives on the Characters sub-screen. Once the host clicks Host, config is
frozen and the Lobby only shows the room code, QR, and player list. Joined
players see nothing about the match they're about to play.

We want the Lobby to be where the host *stages the match*: pick a map with an
immersive **preview**, toggle mobs, and set land size / map objects — all after
the room exists, with joined players seeing a **read-only** view of the host's
choices. The misleading "Settings" menu tab is removed.

## Goals

1. **Move all game settings into the Lobby** (host-only, editable pre-start):
   Arena world (with preview), Land size, Map objects, Mob spawns.
2. **Immersive map preview**: a rich **stylized card** per arena world — layered
   CSS/SVG gradients + hazard motif + iconography — upgrading today's flat
   color-swatch card. The selected map shows an enlarged "hero" preview in the
   lobby.
3. **Remove the "Settings" menu tab** and its sub-screen; relocate its controls.
   Remove the Mob toggle from the Characters screen.
4. **Sync host config to joined clients** as a read-only view (map hero preview +
   summary of land size / mobs / objects), via the existing `MSG.LOBBY` message.

Non-goals: changing map generation, gameplay, or the wire STATE protocol. No new
build tooling or image assets (stylized card is pure CSS/SVG).

## Architecture & Data Flow

### Config ownership
- The `Simulation` is created in `startHosting()` (`src/main.js`) and already
  holds `world`, `landSize`, `enabledObstacles`, `mobsEnabled`. It starts in
  `PHASE.LOBBY`.
- **New**: add `Simulation.configure({ arenaWorld, landSize, enabledObstacles,
  mobsEnabled })` (in `src/sim.js`) that, **only while `phase === PHASE.LOBBY`**,
  updates `this.world` (`getArenaWorld`), `this.landSize` (`getArenaLandSize`),
  re-sanitizes `this.enabledObstacles` (same loop as the constructor),
  `this.mobsEnabled`, and rebuilds `this.arena = new LogicArena(world, landSize)`.
  Returns the normalized config. No-op with a warning if not in LOBBY. Map layout
  is regenerated at `beginRound()` from these fields, so no eager regen needed.
- Host seeds the sim from last-used config (localStorage) at create time; the
  lobby controls then drive `sim.configure(...)` on every change.

### Host lobby controls
- The host still gathers an initial config when clicking Host (keep
  `getArenaSettings()` + `mobsEnabled()` so localStorage defaults carry over).
- **New**: lobby-scoped controls rendered inside the `#lobby` panel (host-only).
  On any change, `main.js` calls `sim.configure(ui.getArenaSettings()/mobsEnabled)`
  then `pushLobby()` to re-broadcast. Reuse the existing builders
  (`_buildArenaCards`, `_buildLandSizeSegmented`, `_buildMapObjectsToggles`,
  `_buildMobsToggle`) — move the DOM into the lobby and keep the same
  `#arena-world`, `#land-size`, `#map-objects-ui`, `#mobs-toggle` element ids so
  `getArenaSettings()`/`mobsEnabled()`/`_getEnabledObstacles()` keep working
  unchanged.

### Client read-only view
- Extend the `MSG.LOBBY` broadcast in `pushLobby()` (`src/main.js`) with a
  `config` object: `{ arenaWorld, landSize, enabledObstacles, mobsEnabled }`
  read from `sim`.
- On the client, `onLobby` (`src/main.js`) passes `msg.config` to a new
  `ui.renderLobbyConfig(config, { isHost })`. For clients this renders the map
  hero preview + a read-only summary (land size, mobs on/off, object count).
  For the host it's a no-op (host has live controls).
- `MSG.LOBBY` comment in `src/config.js` updated to note the `config` field.

### Preview component
- **New** `ui.renderMapHero(worldId, container)` builds the enlarged stylized
  preview from `CFG.ARENA_WORLDS` + `getArenaHazard()` (top/side colors, hazard
  color/glow/detail). Pure CSS/SVG — layered radial/linear gradients evoking the
  platform + hazard, hazard name, world name. Shared by host (updates on select)
  and client (updates on `MSG.LOBBY`).
- Upgrade the small `.arena-card` markup/CSS (in `_buildArenaCards` +
  `src/style.css`) from a single orb to a layered stylized tile (platform disc +
  hazard glow ring + motif), still compact for the selector grid.

## Files to change
- `src/sim.js` — add `configure()` (LOBBY-only) using existing
  `getArenaWorld`/`getArenaLandSize`/`LogicArena` + obstacle-sanitize loop.
- `src/main.js` — seed sim config; wire lobby control changes → `sim.configure`
  + `pushLobby`; add `config` to `MSG.LOBBY`; client `onLobby` → render read-only.
- `src/ui.js` — relocate arena/land/objects/mobs controls into `#lobby`
  (host-only); add `renderMapHero`, `renderLobbyConfig`; host-only visibility in
  `showLobby`; keep element ids stable. Remove Settings sub-screen wiring.
- `index.html` — remove `#screen-settings` sub-screen + its `data-screen=
  "settings"` spine button; remove mob field from `#screen-characters`; add the
  host config panel + map hero + client read-only summary DOM inside `#lobby`.
- `src/config.js` — update `MSG.LOBBY` comment (add `config`).
- `src/style.css` — stylized arena card + map hero + lobby config panel styling;
  responsive + reduced-motion + visible keyboard focus.

## Design quality bar (frontend-design)
- Stylized cards/hero must read as intentional art, not a templated gradient:
  use each world's `top`/`side`/hazard palette, a platform-disc silhouette, and a
  hazard motif (embers/spray/bubbles/dust/shards hinted via CSS). Respect
  `prefers-reduced-motion` (no looping animation when set). Keyboard focus rings
  visible on cards/toggles. Layout responsive down to mobile lobby width.

## Verification
1. `npm ci` (if needed), `npm test` — all green.
2. `npm run dev -- --port 11525` (or configured dev script) and playtest:
   - Host a room → Lobby shows map selector + previews + land/objects/mobs.
   - Change map → hero preview updates; change mobs/land/objects → persists.
   - Open a 2nd browser context, join by code → joined player sees the same map
     hero + read-only summary; updates when host changes selection.
   - Start match → selected world/land/objects/mobs are applied in-game.
   - Confirm the "Settings" menu tab is gone and Characters screen has no mob
     toggle.
3. Screenshot the lobby (host + client) via chrome-devtools MCP for the PR.
