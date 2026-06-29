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

Live deployment: _coming from Vercel after deploy_

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
| Fire Bolt | Left click / `Space` | FIRE button |

## Project structure

```text
src/
  config.js    Shared constants + wire protocol + room-code helpers
  sim.js       Pure authoritative simulation, no DOM/Three.js coupling
  player.js    Warlock state, movement, charge, knockback physics
  bolt.js      Projectile motion and hit resolution
  arena.js     Shrinking voxel platform and lava visuals
  voxel.js     Low-poly mesh builders
  renderer.js  Three.js scene, camera, interpolation, rendering
  input.js     Keyboard, mouse, and touch input
  net.js       PeerJS host/client networking
  ui.js        Menu, lobby, HUD, invite link, room code, QR code
  main.js      App wiring and host/client loops
test/
  sim.test.mjs     Headless gameplay simulation checks
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
