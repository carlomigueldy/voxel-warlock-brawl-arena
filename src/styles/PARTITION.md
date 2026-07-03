# `style.css` → P5 CSS system partition map

`src/style.css` (2974 lines, "Arcane Voxel Forge") stays **intact and golden**
until P6 — `?ui=legacy` renders off it unchanged. This table is the contract
every P5 sub-issue (#161–#168) follows when it ports a `style.css` section:
**every section maps to exactly one destination, nothing lost, nothing
duplicated.** Global rules (tokens, resets, ambient, FX) landed in p5a
(this PR); per-surface rules land in each sibling's own CSS Modules.

| `style.css` section | → destination | owner |
|---|---|---|
| `:root` tokens | `styles/tokens.css` (verbatim) | p5a ✅ |
| overlay/ambient (`.overlay`, `.hidden`, ember-field, grid-drift) | `styles/global.css` | p5a ✅ |
| global reduced-motion catch-all + resets | `styles/global.css` | p5a ✅ |
| forged panel + brand/title (`panelIn`/`titleDrop`/`fadeDown` keyframes) | shared `Panel` primitive css + `styles/fx.css` (keyframes) | p5a ✅ (primitive + keyframes) / siblings (usage) |
| controls — toggle / segmented / char & arena cards / buttons | shared primitives `ui/common/*.module.css` | p5a ✅ |
| menu body + rune text field + validation | `menu/*.module.css` | p5-menu |
| lobby (room code/QR/player list/bots/map-hero) | `lobby/*.module.css` | p5-lobby-qr |
| HUD top/viewport/launch/ability/item bars/slots + vitals | `hud/*.module.css` | p5-hud |
| spell draft overlay | `draft/*.module.css` | p5-draft |
| onboarding (rail/steps/hero-select/hotkeys) | `onboarding/*.module.css` | p5-onboarding |
| social chat (panel/roster/mute) + pause menu | `pause-chat/*.module.css` | p5-pause-chat |
| touch controls | `touch/*.module.css` | p5-touch |
| screens/nav-feel/gamepad/credits juice | co-located with the component/hook they drive | p5-juice |
| responsive media queries | co-located per module + `styles/global.css` (cross-cutting) | each owner |
| reduced-motion per-feature overrides | co-located per module | each owner |
| FX layer (`fx-particle`/`fx-flash`/`fx-vignette`/`fx-aberration`/`fx-shake` + keyframes) | `styles/fx.css` | p5a ✅ |

## Rules for every sibling

1. **CSS Modules only** for per-surface styling (`*.module.css`), referencing
   `var(--token)` from `styles/tokens.css` — **no hardcoded colors/sizes**.
2. **Reuse the shared primitives** in `src/ui/common/` (`Button`, `Panel`,
   `Modal`, `SegmentedControl`, `Toggle`, `CharacterCard`, `Slider`, `Icon`)
   instead of rebuilding a control style.css already solved.
3. **Global CSS stays in `src/styles/`** — if you find yourself adding a new
   global class or `@keyframes` outside a CSS Module, it almost certainly
   belongs in `tokens.css`/`global.css`/`fx.css` instead (open a note in your
   PR if you think a new global file is warranted; don't add one silently).
4. **`style.css` itself is never edited** by a sibling PR — copy the section
   you're porting, adapt to CSS Modules + React, and leave the legacy file
   byte-identical until P6.
5. **`prefers-reduced-motion` must degrade your surface's animation to
   instant** (audio cues kept) — mirror the pattern in `styles/global.css`'s
   catch-all and `styles/fx.css`'s per-effect overrides.
