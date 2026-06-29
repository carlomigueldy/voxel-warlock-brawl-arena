# Voxel Warlock Brawl

```text
 __      __                 _   __        __              _            _      
 \ \    / /__ __ _____ ___ | |  \ \      / /_ _ _ _ _ ___| |___  __  | |__   
  \ \/\/ / _ \\ \ / -_) / | |__ \ \/\/ / _` | '_| '_/ _ \ / _ \/ _| | '_ \  
   \_/\_/\___/_\_\\___\_\ |____| \_/\_/\__,_|_| |_| \___/_\___/\__| |_.__/  

              .-._   _.-.        LOW-POLY SPELL SLINGING
             /  _ `-' _  \       KNOCKBACK. LAVA. CHAOS.
            |  (o)   (o)  |
             \     ^     /
              `-._____,-'       [ invite link ] [ room code ] [ QR code ]
```

A 3D **low-poly voxel** *Warlock Brawl* clone built with **HTML5 + WebGL + Three.js**, featuring **P2P multiplayer** with invite links, room codes, and QR codes. No build step required.

## Play

Live deployment: https://voxel-warlock-brawl-arena.vercel.app

## What is Warlock Brawl?

Warlock Brawl is inspired by the classic Warcraft III arena minigame:

- **Bolt does knockback**, not direct lethal damage.
- **Knockback scales with charge**: repeated hits make warlocks fly farther.
- **Lava is death**: blast rivals off the shrinking platform.
- **Last warlock standing** wins the round.
- **Host-authoritative P2P multiplayer** keeps one simulation in charge.

## Quick start

```bash
npm start
```

Then open:

```text
http://localhost:8080
```

Any static HTTP server works because the app uses browser-native ES modules and CDN imports.

## Multiplayer

1. Host clicks **Host Game**.
2. Share the generated **room code**, **invite link**, or **QR code**.
3. Friends join from their browser.
4. Host starts the brawl.

> The app uses PeerJS/WebRTC for P2P data channels. STUN is configured by default; restrictive NATs may require TURN infrastructure.

## Controls

| Action | Keyboard/Mouse | Touch |
| --- | --- | --- |
| Move | `WASD` / Arrow keys | Left joystick |
| Aim | Mouse | Screen/movement direction |
| Fire Fireball | Left click / `Space` | FIRE button |
| Cast spell | Spell-slot hotkey at cursor | Tap ability slot |
| Cast selected spell | Right click | Tap ability slot |

Click any slot on the on-screen **ability bar** to select it; the bar also shows
live cooldown sweeps. In rune mode, each warlock has 6 spell slots, looted runes
fill the first empty slot, and each slot hotkey can be rebound with the slot's
small rebind button. Toggle **SFX** and **Music** with the buttons top-right.

## Skills (spellbook — full Warlock Brawl handbook)

Every skill (ability/spell) and item from the
[official handbook](https://www.warlockbrawl.com/handbook) is implemented. Each
skill is bound to a hotkey, has its own cooldown shown on the ability bar, and
ships with bespoke SFX/VFX. Cast a skill by pressing its key while aiming at the
cursor, or select it on the ability bar and right-click to place it.

### Active skills

| Key | Skill | Type | Effect |
| --- | --- | --- | --- |
| `1` | Fireball | Projectile | Core knockback projectile |
| `2` | Lightning | Instant | Chain-lightning to nearby foes |
| `3` | Boomerang | Projectile | Flies out and curves back |
| `4` | Homing | Projectile | Steers toward enemies |
| `5` | Fire Spray | Projectile | Cone of fireballs |
| `6` | Bouncer | Projectile | Ricochets off the rim |
| `7` | Splitter | Projectile | Bursts into shards |
| `8` | Meteor | AoE | Telegraphed slam at a target point |
| `Q` | Teleport | Mobility | Blink toward the cursor |
| `E` | Thrust | Mobility | Launch yourself along your aim |
| `R` | Swap | Utility | Trade places with the nearest enemy |
| `F` | Wind Walk | Buff | Brief stealth + speed |
| `C` | Rush | Buff | Speed + knockback resistance |
| `V` | Drain | Utility | Pull a foe and steal their charge |
| `X` | Gravity | Control | Pull field at a target point |
| `Z` | Link | Control | Bind to a foe |
| `T` | Disable | Control | Silencing projectile |
| `G` | Shield | Defense | Block the next incoming hit |
| `B` | Time Shift | Defense | Rewind to your past position |
| `H` | Pocket Watch | Utility | Reset all your cooldowns |

### Item / passive skills

Defined in `config.js` → `ITEMS` and applied as persistent modifiers:

- **Knockback resist:** Aegis, Cape, Helmet, Warden, Shield
- **Speed:** Boots of Speed, Stone of Jordan
- **Lifesteal:** Blood Sword, Mask of Death
- **Glass cannon:** Cursed Pendant
- **Cooldown reduction:** Pendant, Stone of Jordan
- **Lava grace:** Lava Treads
- **Empowered Fireball:** Staff of Fireball

## Audio & visual effects

- **Procedural SFX** synthesized at runtime (no asset files) — every spell, hit,
  death, countdown and victory cue has its own voice, with stereo panning from
  world position and a reverb send.
- **Generative ambient music** pad under the action.
- **VFX**: per-spell projectile silhouettes, particle bursts, chain-lightning
  arcs, expanding shockwave rings, falling meteors with ground telegraphs, link
  tethers, shield bubbles, wind-walk fade, charge-based emissive glow, and
  impact screen-shake.

## Project structure

```text
src/
  config.js    Shared constants + spellbook + items + wire protocol
  sim.js       Pure authoritative simulation, no DOM/Three.js coupling
  spells.js    Spell-cast resolution for every handbook ability
  player.js    Warlock state, movement, charge, statuses, item modifiers
  bolt.js      All projectile kinds (fireball/homing/boomerang/bouncer/...)
  arena.js     Shrinking voxel platform and lava visuals
  voxel.js     Low-poly mesh builders + VFX (bursts, lightning, meteors)
  renderer.js  Three.js scene, camera, interpolation, VFX, screen-shake
  audio.js     Procedural Web Audio SFX engine + ambient music
  input.js     Keyboard, mouse, and touch input + spell hotkeys
  net.js       PeerJS host/client networking
  ui.js        Menu, lobby, HUD, ability bar, audio toggles, QR code
  main.js      App wiring and host/client loops
test/
  sim.test.mjs     Headless gameplay simulation checks
  spells.test.mjs  Full spellbook + item system checks
  source.test.mjs  Source-level integration checks
```

## Tests

```bash
npm test
```

Covers simulation lifecycle, charge-scaled knockback, edge death, round resolution, malformed input handling, stale snapshot protection, and UI/network source checks.

## Tech stack

- HTML5 Canvas + WebGL
- Three.js via import map
- PeerJS/WebRTC P2P multiplayer
- QR code invite generation
- Static deployment on Vercel

## License

MIT
