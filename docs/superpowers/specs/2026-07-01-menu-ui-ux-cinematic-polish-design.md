# Voxel Warlock Brawl — Menu UI/UX Cinematic Polish (Design Spec)

- **Date:** 2026-07-01
- **Branch:** `feat/ui-ux-enhancements`
- **Status:** approved

## Goal & scope

Refine the game menu UI/UX for an award-winning, immersive, "real game" feel. This is a full game-feel polish pass covering:

- Menu audio cues
- Top-level screen transitions (menu → lobby → game)
- A dedicated victory/results screen (replacing the "Refresh to play again" dead end)
- HUD juice
- Draft-overlay drama
- Navigation feel (ESC/back, spine arrow-keys, gamepad)
- Button micro-interactions
- A credits screen

**Aesthetic direction:** cinematic dramatic push grounded in the existing "Arcane Voxel Forge" tokens, with screen-space post-FX as the one justified aesthetic risk.

**Architecture:** Approach A — unified FX layer.

## Constraints

- **No-build, zero-npm-deps, vanilla-JS + plain-CSS + Three.js + procedural Web Audio.** Extend the existing CSS-keyframes + `--ease-spring` + Three.js + `AudioEngine` pattern. Do **NOT** introduce Framer Motion / GSAP.
- **Preserve the existing accessibility floor:** `:focus-visible` rings, ARIA roles, and `prefers-reduced-motion` support (extend the existing 6 reduced-motion blocks). Every new motion degrades to instant/static under reduced-motion.
- **Copy in plain end-user verbs** ("Play Again", "Return to Menu").

---

## Section 1 — Core architecture (the Juice & FX layer)

### `src/fx.js` (new)

Singleton `FX` with the following API:

| Method | Purpose |
| --- | --- |
| `flash(color, ms)` | Full-screen color flash overlay |
| `vignette(color, ms)` | Screen-edge color vignette (damage, low-HP) |
| `aberration(ms)` | Chromatic-aberration post-FX burst |
| `shake(amp, ms)` | Screen shake via `.fx-shake` + `--shake-amp` |
| `burst(x, y, kind, n)` | DOM particle emitter (generalized ember-field technique) |
| `onStage(event, cb)` / `emitStage(event, opts)` | Three.js stage-event bus |
| `reducedMotion` | Cached `matchMedia('(prefers-reduced-motion: reduce)')` flag |

Implementation notes:

- CSS filters applied on a `#fx-layer` overlay element.
- DOM particle emitter generalizes the existing ember-field technique.
- Screen-shake via `.fx-shake` class + `--shake-amp` custom property.
- Three.js stage-event bus bridges FX layer to the 3D scene.
- **All motion degrades under `prefers-reduced-motion`.**

### `src/style.css`

New `--fx-*` tokens:

- `--fx-vignette-dmg`
- `--fx-vignette-lowhp`
- `--fx-flash-victory`
- `--shake-amp`
- `--aberration-offset`

New `@keyframes`:

- `cinematicIn`
- `victoryRise`
- `lockIn`
- `ripple`
- `lowHpPulse`
- `fx-shake`
- particle variants

Extended reduced-motion blocks.

### `src/audio.js`

`menuCue(name)` registry synthesized through the existing reverb bus. Cues:

- `hover`
- `confirm`
- `back`
- `transition`
- `victory`
- `defeat`
- `lockin`
- `countdown`

Respects SFX mute. Exported standalone `menuCue` for ES-module import.

### `ScreenDirector` (new `src/screens.js`)

Orchestrates menu → lobby → game crossfades:

```
flash → fade-out → swap → fade-in → transition cue
```

- Old `show*` functions become thin wrappers / MutationObserver-driven.
- Sub-screen routing keeps its slide and gains audio cues.

---

## Section 2 — Cinematic flow

### 2.1 Top-level transitions

`ScreenDirector.go()` sequence:

1. ember-flash
2. fade + slide out (0.22 s)
3. `.hidden` swap
4. fade + slide in (0.28 s, `--ease-spring`)
5. `menuCue('transition')`

Reduced-motion → instant.

**Lobby → game** adds a **"ROUND 1" full-bleed `--arcane` card** (`cinematicIn`, 1.2 s) collapsing into the in-game countdown.

### 2.2 Victory / Results screen (`#results-screen`)

**Beat 1 (0–1.5 s):**

- `FX.flash(gold)` + `aberration` + `shake` + `menuCue('victory')`
- 3D stage orbit / dolly + ember-burst
- "VOXEL WARLOCK VICTOR" title (`victoryRise`)

**Beat 2** — forged `.panel` scoreboard:

- Columns: `rank | warlock | K | D | damage`
- Staggered `playerIn` rows
- #1 row gets `--gold` + crown
- Data from new `Sim.finalStats()`

**Beat 3** — CTAs:

- "Play Again" (re-queue same room)
- "Return to Menu"

**Defeat path** = subdued drone + low sting.

### 2.3 Credits screen

- New spine entry (replaces footer link).
- Slow vertical scroll over ember field + voxel grid.
- Press Start 2P headers.
- ESC / Back returns.
- Credits: `carlomigueldy.dev` + Three.js / PeerJS / Supabase / Meshy + spell-icon credits.

---

## Section 3 — In-match juice

### 3.1 HUD

| Trigger | Effect |
| --- | --- |
| HP bar damage | `FX.vignette(dmg)` + red flash + shake |
| < 30% HP | sustained `lowHpPulse` + subtle heartbeat cue |
| Heal | `--rune` flash |
| Charge bar at max | shimmer |
| Cast bar | `--arcane` leading-edge glow |
| Ability slot cooldown-complete | bump + tick |
| On cast | `FX.burst` sparks |
| Ability slot size | 66 → 78 px |
| Scoreboard leader row | `--gold` glow |

### 3.2 Draft overlay

- Slot pips → glowing rune-stones filling `--arcane`.
- Spell cards → per-school rarity glow on hover.
- Lock-in → `FX.burst` school sparks + `lockIn` + `menuCue('lockin')`.
- Timer → escalating `menuCue('countdown')` in final 5 s.
- All-locked → `FX.flash(arcane)` + chord → round-start cinematic.

### 3.3 Button micro-interactions

- All `.btn-forge` / controls `pointerdown` → `ripple` keyframe + `FX.burst(spark, 6)` + `menuCue('confirm')`.
- Hover → existing spark sweep + `menuCue('hover')` (throttled).
- Back / ghost → `menuCue('back')`.

---

## Section 4 — Navigation & input

### 4.1 ESC / Back

Extended global ESC:

- Menu sub-screen → default / Online.
- Lobby → confirm-leave.
- Results → Return to Menu.

Persistent **"‹ BACK"** affordance on sub-screens.

### 4.2 Spine nav arrows

`.spine-btn` becomes `role="tablist"` / `tab` with **roving tabindex** + `↑` / `↓` / `Home` / `End` (mirrors `tutorial-tabs` at `ui.js:1705-1721`). `menuCue('hover')` on focus move.

### 4.3 Gamepad

New `src/gamepad.js` polling `navigator.getGamepads()` in its own rAF:

- D-pad / stick → synthetic arrow-key events (reuses spine + tutorial logic).
- **A** → activate.
- **B** → ESC / back.
- **Start** → pause / resume.

Deadzone + focus-throttle. `--ember` focus ring.

### 4.4 Menu audio wiring

Throttled `menuCue` calls across UI hover / click handlers; respects existing mute toggles.

---

## Section 5 — Implementation (parallel tracks)

All tracks consume the Section-1 FX layer.

| Track | Module | Scope |
| --- | --- | --- |
| **T1** | `src/fx.js` + tokens | FX engine + tokens (foundation) |
| **T2** | `src/audio.js` | `menuCue` registry (foundation) |
| **T3** | `src/screens.js` | `ScreenDirector` + transitions + round card |
| **T4** | results screen + `Sim.finalStats()` + preview camera | |
| **T5** | `renderer.js` hooks | HUD juice |
| **T6** | `src/draft-juice.js` | draft drama (event delegation) |
| **T7** | `src/button-juice.js` | button micro-interactions (document delegation) |
| **T8** | `src/nav-feel.js` | nav feel |
| **T9** | `src/gamepad.js` | gamepad |
| **T10** | `src/credits.js` | credits |

**Phasing:** T1 + T2 first; then T3–T10 in parallel waves.

**Module loading:** self-contained modules loaded via `<script type="module">` tags; CSS-in-JS injection to avoid shared-file conflicts.

**Gate:** Opus Reviewer adversarial gate before epic → `main` PR (Hard-rule 5).

---

## Acceptance criteria

- [ ] Menu → lobby → game transitions are animated crossfades (not instant cuts); reduced-motion = instant.
- [ ] A dedicated results screen replaces "Refresh to play again", with scoreboard + Play Again / Return to Menu.
- [ ] Menu interactions produce audio cues (hover / confirm / back / transition); cues respect SFX mute.
- [ ] HUD shows damage / low-HP / charge / cast juice; ability slots bump on ready and burst on cast.
- [ ] Draft overlay has lock-in sparks + countdown cues + all-locked celebration.
- [ ] ESC / back works across menu / lobby / results; spine nav supports arrow keys.
- [ ] Gamepad navigates menus (D-pad / arrows, A = activate, B = back, Start = pause).
- [ ] All new motion degrades under `prefers-reduced-motion`; `:focus-visible` rings on all new interactive elements; responsive down to mobile.
- [ ] `npm ci` → `npm test` → `python3 -m json.tool feature_list.json` gates green.
