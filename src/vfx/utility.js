// Faceted duotone VFX for the mobility / utility / buff spells — teleport,
// blink, swap, thrust, rush, windWalk, speed, shield, heal, invisible,
// summon, timeShift, pocketWatch, plus the drain charge-steal sparkle. Each
// entry below echoes its bespoke SVG glyph in src/spell-icons.js in 3D:
//   - teleport / blink : nested faceted diamonds — a shrinking "departure"
//                        gem and a blooming "arrival" gem (portal open/close)
//   - swap             : twin faceted orbs flashing in place (the icon's two
//                        swapping circles)
//   - thrust / rush /
//     speed / windWalk  : forward-fanning faceted streak shards, echoing the
//                        icons' chevrons / speed lines
//   - shield           : a faceted shield-shell aura that rises on cast and
//                        flashes/contracts on an absorbed hit
//   - heal             : a rising faceted plus-shard, matching the icon's
//                        diamond + cross glyph
//   - invisible        : a faceted veil aura that shrinks to near-zero
//                        opacity, scattering faint dash-shards
//   - summon           : a faceted hex sigil disc with a rune-diamond pop
//   - timeShift /
//     pocketWatch       : a faceted clock ring with a sweeping hand shard
//   - drain             : an inward spiral of spark shards at the drained
//                        target (cast) that converges to a flash at the
//                        caster (impact) — the "charge-steal sparkle"
// All built from facetedDuo()'s flat-shaded emissive primary + ~0.45
// translucent secondary recipe (./duotone.js) over faceted low-poly
// primitives (../lowpoly.js). No gradients/smooth shading anywhere.
//
// Convention: cast(ctx) / impact(ctx) build every piece an effect needs (the
// bespoke faceted group(s) plus any convenience ctx.burstAt/ctx.ringPulse
// accents) and add each one via ctx.addEffect(...) themselves, then return
// null. ctx already carries everything needed to add effects to the scene,
// so nothing is left for a caller to add from a return value — this keeps
// multi-piece effects (e.g. a portal gem + a spark burst) unambiguous:
// nothing is ever added to the scene twice.
import * as THREE from "three";
import { SPELLS } from "../config.js";
import { facetedDuo, brighten } from "./duotone.js";
import {
  facetedOrb, facetedShard, facetedCrystal, facetedPuff, facetedAura,
  facetedCylinder, facetedTorus,
} from "../lowpoly.js";

// ---------------------------------------------------------------------------
// Transient-effect scaffold — every cast()/impact() builder below wires a
// THREE.Group up to the renderer's transient-VFX contract (see
// src/renderer.js's `this.effects` update/cull loop: userData.update(dt),
// userData.done, userData.dispose()) via this one helper, so individual
// spell builders only describe *what* to animate, not the bookkeeping.
// ---------------------------------------------------------------------------

// life    — seconds until userData.done flips true (effect is then culled
//           and disposed by the renderer's effects loop).
// buildFn — (g, disposables) => tick(k, dt)|undefined. Adds child meshes to
//           `g` and pushes anything with a userData.dispose() (facetedDuo
//           groups, or plain meshes wrapped via _addPlain below) into
//           `disposables` so geometry/materials are freed on cull. The
//           returned tick(k, dt) (k = elapsed/life, clamped 0..1) runs every
//           frame; omit it for a static one-shot shape that just times out.
function _effect(life, buildFn) {
  const g = new THREE.Group();
  const disposables = [];
  const tick = buildFn(g, disposables);
  g.userData.t = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = Math.min(1, g.userData.t / life);
    tick?.(k, dt);
    if (g.userData.t >= life) g.userData.done = true;
  };
  g.userData.dispose = () => {
    for (const d of disposables) d.userData?.dispose?.();
  };
  return g;
}

// Add a facetedDuo() child (builder-mode: geometry is instance-owned and
// freed on dispose) at a local offset, track it for disposal, return it.
function _duo(g, disposables, builder, color, opts, x = 0, y = 0, z = 0) {
  const d = facetedDuo(builder, color, opts);
  d.position.set(x, y, z);
  g.add(d);
  disposables.push(d);
  return d;
}

// Add a plain lowpoly.js mesh (not wrapped in facetedDuo — used for lone
// translucent accents like windWalk's wind puffs) and register its
// geometry/material for disposal alongside the facetedDuo children.
function _addPlain(g, disposables, mesh) {
  g.add(mesh);
  disposables.push({ userData: { dispose: () => { mesh.geometry?.dispose(); mesh.material?.dispose(); } } });
  return mesh;
}

// Fade both layers of a facetedDuo child together. Only fades the primary if
// its material was built with `transparent: true` (buildCore pieces stay
// opaque by design; cast()/impact() pieces that need to fade pass it).
function _fadeDuo(d, o) {
  if (d.userData.primary.material.transparent) d.userData.primary.material.opacity = o;
  d.userData.secondary.material.opacity = 0.45 * o;
}

function _spellColor(id, fallback) {
  return SPELLS[id]?.color ?? fallback;
}

// A handful of short-lived faceted shard streaks fanning outward in the XZ
// plane — the shared "speed lines / chevrons" motif behind thrust, rush,
// speed and windWalk. Shards are elongated along local X (via sx) then
// rotated about Y so their long axis points radially, and they fly outward
// while shrinking/fading over the effect's life.
function _streakFan(g, disposables, color, opts = {}) {
  const count = opts.count ?? 4;
  const length = opts.length ?? 0.42;
  const speed = opts.speed ?? 5.5;
  const spread = opts.spread ?? Math.PI * 0.6;
  const baseAngle = opts.angle ?? Math.random() * Math.PI * 2;
  const shards = [];
  for (let i = 0; i < count; i++) {
    const a = baseAngle + (Math.random() - 0.5) * spread;
    const d = _duo(g, disposables, (c, o) => facetedShard(length, c, {
      sx: length, sy: 0.1, sz: 0.1, ry: -a, transparent: true, ...o,
    }), color, {}, 0, 0, 0);
    d.userData.a = a;
    shards.push(d);
  }
  return (k, dt) => {
    for (const d of shards) {
      const dist = speed * ((k * (2 - k))) * 0.4;
      d.position.set(Math.cos(d.userData.a) * dist, d.position.y, Math.sin(d.userData.a) * dist);
      _fadeDuo(d, Math.max(0, 1 - k));
      d.scale.setScalar(Math.max(0.05, 1 - k * 0.5));
    }
  };
}

// ---------------------------------------------------------------------------
// teleport — nested faceted diamonds: a shrinking departure gem (cast) and a
// blooming arrival gem (impact), matching the icon's two connected diamonds.
// ---------------------------------------------------------------------------
function _teleportCore(color) {
  return facetedDuo((c, o) => facetedCrystal(0.32, c, { sx: 0.85, sy: 1.05, sz: 0.85, ...o }), color, {});
}

function _teleportCast(ctx) {
  const color = ctx.color;
  const eff = _effect(0.3, (g, disposables) => {
    const gem = _duo(g, disposables, (c, o) => facetedCrystal(0.45, c, {
      sx: 0.9, sy: 1.1, sz: 0.9, transparent: true, ...o,
    }), color, {}, 0, 1, 0);
    return (k) => {
      gem.scale.setScalar(Math.max(0.02, 1 - k));
      gem.rotation.y += 0.4;
      _fadeDuo(gem, 1 - k);
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.burstAt(ctx.x, ctx.z, brighten(color, 0.2), { count: 10, speed: 5, life: 0.3 }, ctx.y ?? 1.0));
  return null;
}

function _teleportImpact(ctx) {
  const color = ctx.color;
  const eff = _effect(0.35, (g, disposables) => {
    const gem = _duo(g, disposables, (c, o) => facetedCrystal(0.45, c, {
      sx: 0.9, sy: 1.1, sz: 0.9, transparent: true, ...o,
    }), color, {}, 0, 1, 0);
    gem.scale.setScalar(0.05);
    return (k) => {
      gem.scale.setScalar(0.05 + k * 1.15 * (1 - 0.3 * k));
      gem.rotation.y -= 0.5;
      _fadeDuo(gem, 1 - k * 0.85);
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 1.6, color));
  return null;
}

// ---------------------------------------------------------------------------
// blink — a tighter, faster teleport: same nested-diamond language, smaller
// and quicker for a short instant hop.
// ---------------------------------------------------------------------------
function _blinkCore(color) {
  return facetedDuo((c, o) => facetedCrystal(0.22, c, { sx: 0.8, sy: 0.95, sz: 0.8, ...o }), color, {});
}

function _blinkPop(ctx, grow) {
  const color = ctx.color;
  const eff = _effect(0.18, (g, disposables) => {
    const gem = _duo(g, disposables, (c, o) => facetedCrystal(0.3, c, {
      sx: 0.85, sy: 1.0, sz: 0.85, transparent: true, ...o,
    }), color, {}, 0, 1, 0);
    gem.scale.setScalar(grow ? 0.05 : 1);
    return (k) => {
      gem.scale.setScalar(grow ? 0.05 + k * 1.1 : Math.max(0.02, 1 - k));
      gem.rotation.y += grow ? -0.6 : 0.6;
      _fadeDuo(gem, grow ? 1 - k * 0.8 : 1 - k);
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.burstAt(ctx.x, ctx.z, brighten(color, 0.25), { count: 6, speed: 4, life: 0.22 }, ctx.y ?? 1.0));
  return null;
}
const _blinkCast = (ctx) => _blinkPop(ctx, false);
const _blinkImpact = (ctx) => _blinkPop(ctx, true);

// ---------------------------------------------------------------------------
// swap — twin faceted orbs flashing (the icon's two circles), each ringed by
// a short counter-orbiting spark arc echoing the icon's opposing arrows.
// ---------------------------------------------------------------------------
function _swapCore(color) {
  const g = new THREE.Group();
  const a = facetedDuo((c, o) => facetedOrb(0.18, c, o), color, {});
  const b = facetedDuo((c, o) => facetedOrb(0.18, c, o), color, {});
  a.position.x = -0.32; b.position.x = 0.32;
  g.add(a, b);
  g.userData.recolor = (nc) => { a.userData.recolor(nc); b.userData.recolor(nc); };
  g.userData.dispose = () => { a.userData.dispose(); b.userData.dispose(); };
  return g;
}

// Two thin shards sweep opposite directions around a central flash orb,
// echoing the icon's opposing swap arrows.
function _swapFlash(ctx) {
  const color = ctx.color;
  const eff = _effect(0.35, (g, disposables) => {
    const orb = _duo(g, disposables, (c, o) => facetedOrb(0.3, c, { transparent: true, ...o }), color, {}, 0, 1, 0);
    const arcA = _duo(g, disposables, (c, o) => facetedShard(0.3, c, { sx: 0.3, sy: 0.08, sz: 0.08, transparent: true, ...o }), color, {}, 0, 1, 0);
    const arcB = _duo(g, disposables, (c, o) => facetedShard(0.3, c, { sx: 0.3, sy: 0.08, sz: 0.08, transparent: true, ...o }), color, {}, 0, 1, 0);
    return (k) => {
      orb.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.25);
      _fadeDuo(orb, 1 - k);
      arcA.rotation.y = k * Math.PI * 2.2;
      arcB.rotation.y = -k * Math.PI * 2.2;
      _fadeDuo(arcA, 1 - k); _fadeDuo(arcB, 1 - k);
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  return null;
}
const _swapCast = _swapFlash;
const _swapImpact = _swapFlash;

// ---------------------------------------------------------------------------
// thrust — forward-fanning streak shards on cast, a faceted debris shockwave
// on impact (the shockKb/shockRadius blast landing).
// ---------------------------------------------------------------------------
function _thrustCore(color) {
  return facetedDuo((c, o) => facetedShard(0.55, c, { sx: 0.55, sy: 0.16, sz: 0.16, ...o }), color, {});
}

function _thrustCast(ctx) {
  const color = ctx.color;
  const eff = _effect(0.3, (g, disposables) => _streakFan(g, disposables, color, { count: 4, length: 0.5, speed: 7, spread: Math.PI * 0.4 }));
  eff.position.set(ctx.x, ctx.y ?? 1.0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.burstAt(ctx.x, ctx.z, 0xffffff, { count: 6, speed: 5, life: 0.25 }, ctx.y ?? 1.0));
  return null;
}

function _thrustImpact(ctx) {
  const color = ctx.color;
  const eff = _effect(0.45, (g, disposables) => {
    const count = 6;
    const bits = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const d = _duo(g, disposables, (c, o) => facetedShard(0.22, c, { sx: 0.22, sy: 0.1, sz: 0.1, ry: -a, transparent: true, ...o }), color, {}, 0, 0, 0);
      d.userData.a = a;
      bits.push(d);
    }
    return (k) => {
      for (const d of bits) {
        const r = 2.2 * k;
        d.position.set(Math.cos(d.userData.a) * r, 0.2, Math.sin(d.userData.a) * r);
        _fadeDuo(d, Math.max(0, 1 - k));
      }
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 3.2, color));
  return null;
}

// ---------------------------------------------------------------------------
// rush — a burst of forward streak shards on cast (sprint start); no impact
// (duration buff, resolves via server-side movement, not a VFX moment).
// ---------------------------------------------------------------------------
function _rushCore(color) {
  const g = new THREE.Group();
  const a = facetedDuo((c, o) => facetedShard(0.5, c, { sx: 0.5, sy: 0.14, sz: 0.14, ...o }), color, {});
  const b = facetedDuo((c, o) => facetedShard(0.3, c, { sx: 0.3, sy: 0.1, sz: 0.1, ...o }), color, {});
  a.position.x = 0.05; b.position.x = -0.4;
  g.add(a, b);
  g.userData.recolor = (nc) => { a.userData.recolor(nc); b.userData.recolor(nc); };
  g.userData.dispose = () => { a.userData.dispose(); b.userData.dispose(); };
  return g;
}

function _rushCast(ctx) {
  const color = ctx.color;
  const eff = _effect(0.35, (g, disposables) => _streakFan(g, disposables, color, { count: 5, length: 0.6, speed: 8, spread: Math.PI * 0.3 }));
  eff.position.set(ctx.x, ctx.y ?? 1.0, ctx.z);
  ctx.addEffect(eff);
  return null;
}
const _rushImpact = () => null;

// ---------------------------------------------------------------------------
// windWalk — a swirl of translucent wind puffs orbiting outward alongside a
// central streak arrow, matching the icon's curved wind lines + arrow.
// ---------------------------------------------------------------------------
function _windWalkCore(color) {
  const g = new THREE.Group();
  const arrow = facetedDuo((c, o) => facetedShard(0.45, c, { sx: 0.45, sy: 0.13, sz: 0.13, ...o }), color, {});
  const puff = facetedPuff(0.3, color, { opacity: 0.3 });
  puff.position.x = -0.3;
  g.add(arrow, puff);
  g.userData.recolor = (nc) => arrow.userData.recolor(nc);
  g.userData.dispose = () => { arrow.userData.dispose(); puff.geometry.dispose(); puff.material.dispose(); };
  return g;
}

function _windWalkCast(ctx) {
  const color = ctx.color;
  const eff = _effect(0.5, (g, disposables) => {
    const arrow = _duo(g, disposables, (c, o) => facetedShard(0.5, c, { sx: 0.5, sy: 0.14, sz: 0.14, transparent: true, ...o }), color, {});
    const puffs = [];
    for (let i = 0; i < 3; i++) {
      const p = facetedPuff(0.22, color, { opacity: 0.35 });
      _addPlain(g, disposables, p);
      puffs.push({ mesh: p, a0: (i / 3) * Math.PI * 2 });
    }
    return (k) => {
      arrow.scale.setScalar(1 + k * 0.6);
      _fadeDuo(arrow, Math.max(0, 1 - k));
      for (const p of puffs) {
        const a = p.a0 + k * Math.PI * 2.5;
        const r = 0.25 + k * 0.9;
        p.mesh.position.set(Math.cos(a) * r, k * 0.5, Math.sin(a) * r);
        p.mesh.material.opacity = 0.35 * (1 - k);
        p.mesh.scale.setScalar(Math.max(0.1, 1 - k * 0.5));
      }
    };
  });
  eff.position.set(ctx.x, ctx.y ?? 1.0, ctx.z);
  ctx.addEffect(eff);
  return null;
}
const _windWalkImpact = () => null;

// ---------------------------------------------------------------------------
// speed (Haste) — a tight double-chevron streak burst (the icon's ">>").
// ---------------------------------------------------------------------------
function _speedCore(color) {
  const g = new THREE.Group();
  const a = facetedDuo((c, o) => facetedShard(0.4, c, { sx: 0.4, sy: 0.12, sz: 0.12, ...o }), color, {});
  const b = facetedDuo((c, o) => facetedShard(0.4, c, { sx: 0.4, sy: 0.12, sz: 0.12, ...o }), color, {});
  a.position.x = 0.18; b.position.x = -0.22;
  g.add(a, b);
  g.userData.recolor = (nc) => { a.userData.recolor(nc); b.userData.recolor(nc); };
  g.userData.dispose = () => { a.userData.dispose(); b.userData.dispose(); };
  return g;
}

function _speedCast(ctx) {
  const color = ctx.color;
  const eff = _effect(0.32, (g, disposables) => _streakFan(g, disposables, color, { count: 3, length: 0.4, speed: 7, spread: Math.PI * 0.15 }));
  eff.position.set(ctx.x, ctx.y ?? 1.0, ctx.z);
  ctx.addEffect(eff);
  const eff2 = _effect(0.4, (g, disposables) => _streakFan(g, disposables, color, { count: 3, length: 0.4, speed: 7, spread: Math.PI * 0.15, angle: 0 }));
  eff2.position.set(ctx.x, (ctx.y ?? 1.0) + 0.15, ctx.z);
  ctx.addEffect(eff2);
  return null;
}
const _speedImpact = () => null;

// ---------------------------------------------------------------------------
// shield — a faceted shell aura that rises on cast and flashes/contracts
// when it absorbs a hit, echoing the icon's kite shape + top-right sparkle.
// ---------------------------------------------------------------------------
function _shieldCore(color) {
  return facetedDuo((c, o) => facetedCrystal(0.4, c, { sx: 0.9, sy: 1.25, sz: 0.55, ...o }), color, {});
}

function _shieldCast(ctx) {
  const color = ctx.color;
  const eff = _effect(0.5, (g, disposables) => {
    const shell = _duo(g, disposables, (c, o) => facetedAura(0.6, c, { opacity: 0.3, transparent: true, ...o }), color, {}, 0, 1, 0);
    const rim = _duo(g, disposables, (c, o) => facetedCrystal(0.4, c, { sx: 0.85, sy: 1.2, sz: 0.5, transparent: true, ...o }), color, {}, 0, 1, 0);
    shell.scale.setScalar(0.6); rim.scale.setScalar(0.3);
    return (k) => {
      shell.scale.setScalar(0.6 + k * 0.7);
      shell.userData.primary.material.opacity = 0.3 * (1 - k * 0.6);
      rim.scale.setScalar(0.3 + k * 0.75);
      _fadeDuo(rim, Math.max(0, 1 - k * 0.5));
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 1.8, color));
  return null;
}

function _shieldImpact(ctx) {
  const color = ctx.color;
  const eff = _effect(0.3, (g, disposables) => {
    const flash = _duo(g, disposables, (c, o) => facetedCrystal(0.5, c, { sx: 0.9, sy: 1.25, sz: 0.55, transparent: true, ...o }), brighten(color, 0.3), {}, 0, 1, 0);
    return (k) => {
      flash.scale.setScalar(Math.max(0.05, 1.3 - k * 1.1));
      _fadeDuo(flash, Math.max(0, 1 - k));
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.burstAt(ctx.x, ctx.z, brighten(color, 0.3), { count: 12, speed: 6, life: 0.3 }, ctx.y ?? 1.2));
  return null;
}

// ---------------------------------------------------------------------------
// heal — a rising faceted plus-shard (the icon's diamond + cross), fading as
// it drifts up. Fired once per heal channel tick.
// ---------------------------------------------------------------------------
function _healCore(color) {
  const g = new THREE.Group();
  const gem = facetedDuo((c, o) => facetedCrystal(0.28, c, o), color, {});
  const barA = facetedDuo((c, o) => facetedShard(0.42, c, o), color, {});
  const barB = facetedDuo((c, o) => facetedShard(0.42, c, { rz: Math.PI / 2, ...o }), color, {});
  g.add(gem, barA, barB);
  g.userData.recolor = (nc) => { gem.userData.recolor(nc); barA.userData.recolor(nc); barB.userData.recolor(nc); };
  g.userData.dispose = () => { gem.userData.dispose(); barA.userData.dispose(); barB.userData.dispose(); };
  return g;
}

function _healCast(ctx) {
  const color = ctx.color;
  const eff = _effect(0.55, (g, disposables) => {
    const barA = _duo(g, disposables, (c, o) => facetedShard(0.3, c, { sx: 0.09, sy: 0.3, sz: 0.09, transparent: true, ...o }), color, {}, 0, 1, 0);
    const barB = _duo(g, disposables, (c, o) => facetedShard(0.3, c, { sx: 0.3, sy: 0.09, sz: 0.09, transparent: true, ...o }), color, {}, 0, 1, 0);
    return (k) => {
      const y = 1 + k * 0.9;
      barA.position.y = y; barB.position.y = y;
      barA.rotation.y = barB.rotation.y = k * 1.2;
      _fadeDuo(barA, Math.max(0, 1 - k)); _fadeDuo(barB, Math.max(0, 1 - k));
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.burstAt(ctx.x, ctx.z, color, { count: 6, speed: 3, life: 0.4 }, ctx.y ?? 1.0));
  return null;
}
const _healImpact = () => null;

// ---------------------------------------------------------------------------
// invisible — a faceted veil aura shrinking to near-zero opacity, scattering
// faint dash-shards (the icon's dashed silhouette lines).
// ---------------------------------------------------------------------------
function _invisibleCore(color) {
  return facetedDuo((c, o) => facetedCrystal(0.3, c, { sx: 0.75, sy: 1.3, sz: 0.6, ...o }), color, { secondaryOpacity: 0.25 });
}

function _invisibleCast(ctx) {
  const color = ctx.color;
  const eff = _effect(0.45, (g, disposables) => {
    const veil = _duo(g, disposables, (c, o) => facetedAura(0.55, c, { opacity: 0.4, transparent: true, ...o }), color, {}, 0, 1, 0);
    const dashes = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const d = _duo(g, disposables, (c, o) => facetedShard(0.18, c, { sx: 0.18, sy: 0.06, sz: 0.06, ry: -a, transparent: true, ...o }), color, {}, 0, 1, 0);
      d.userData.a = a;
      dashes.push(d);
    }
    return (k) => {
      veil.scale.setScalar(1 - k * 0.5);
      veil.userData.primary.material.opacity = 0.4 * (1 - k);
      for (const d of dashes) {
        const r = 0.9 * k;
        d.position.set(Math.cos(d.userData.a) * r, 1, Math.sin(d.userData.a) * r);
        _fadeDuo(d, Math.max(0, 1 - k));
      }
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  return null;
}
const _invisibleImpact = () => null;

// ---------------------------------------------------------------------------
// summon — a faceted hex sigil disc scaling in, with a rune-diamond pop
// above it (the icon's nested hexagon + small rune diamond).
// ---------------------------------------------------------------------------
function _summonCore(color) {
  const g = new THREE.Group();
  const disc = facetedDuo((c, o) => facetedCylinder(0.42, 0.42, 0.1, c, { segments: 6, ...o }), color, {});
  const rune = facetedDuo((c, o) => facetedCrystal(0.16, c, o), color, {});
  rune.position.y = 0.32;
  g.add(disc, rune);
  g.userData.recolor = (nc) => { disc.userData.recolor(nc); rune.userData.recolor(nc); };
  g.userData.dispose = () => { disc.userData.dispose(); rune.userData.dispose(); };
  return g;
}

function _summonCast(ctx) {
  const color = ctx.color;
  const eff = _effect(0.5, (g, disposables) => {
    const disc = _duo(g, disposables, (c, o) => facetedCylinder(0.55, 0.55, 0.1, c, { segments: 6, transparent: true, ...o }), color, {}, 0, 0.08, 0);
    const rune = _duo(g, disposables, (c, o) => facetedCrystal(0.22, c, { transparent: true, ...o }), color, {}, 0, 0, 0);
    disc.scale.setScalar(0.05); rune.scale.setScalar(0.05);
    return (k) => {
      disc.scale.set(0.05 + k * 0.95, 1, 0.05 + k * 0.95);
      disc.rotation.y = k * 1.5;
      _fadeDuo(disc, Math.min(1, 1.4 - k));
      rune.position.y = 0.3 + k * 0.3;
      rune.scale.setScalar(Math.min(1, k * 1.6));
      rune.rotation.y = -k * 2;
      _fadeDuo(rune, Math.min(1, 1.6 - k));
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 2.0, color));
  return null;
}
const _summonImpact = () => null;

// ---------------------------------------------------------------------------
// timeShift / pocketWatch — a faceted clock ring with a shard "hand" swept
// via direct position trig (simpler & more predictable than nested Euler
// rotations), echoing the icon's ring + rewind/reset sweep arrows.
// ---------------------------------------------------------------------------
function _clockCore(color) {
  const g = new THREE.Group();
  const ring = facetedDuo((c, o) => facetedTorus(0.4, 0.06, c, { rx: Math.PI / 2, radialSegments: 6, tubularSegments: 10, ...o }), color, {});
  const hand = facetedDuo((c, o) => facetedShard(0.28, c, { sx: 0.28, sy: 0.06, sz: 0.06, ...o }), color, {});
  hand.position.x = 0.14;
  g.add(ring, hand);
  g.userData.recolor = (nc) => { ring.userData.recolor(nc); hand.userData.recolor(nc); };
  g.userData.dispose = () => { ring.userData.dispose(); hand.userData.dispose(); };
  return g;
}

// direction = +1 sweeps hand forward (pocketWatch reset), -1 sweeps it
// backward (timeShift rewind) — matches the icon's two opposing arc arrows.
function _clockSweep(ctx, life, turns, direction, ringPulseR) {
  const color = ctx.color;
  const eff = _effect(life, (g, disposables) => {
    const ring = _duo(g, disposables, (c, o) => facetedTorus(0.5, 0.07, c, { rx: Math.PI / 2, radialSegments: 6, tubularSegments: 10, transparent: true, ...o }), color, {}, 0, 1, 0);
    const hand = _duo(g, disposables, (c, o) => facetedShard(0.35, c, { sx: 0.35, sy: 0.07, sz: 0.07, transparent: true, ...o }), color, {}, 0, 1, 0);
    return (k) => {
      ring.scale.setScalar(Math.min(1, k * 3));
      _fadeDuo(ring, Math.max(0, 1 - k * 0.7));
      const a = direction * k * Math.PI * 2 * turns;
      hand.position.set(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4);
      hand.rotation.y = -a;
      _fadeDuo(hand, Math.max(0, 1 - k * 0.6));
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.burstAt(ctx.x, ctx.z, color, { count: 8, speed: 4, life: 0.35 }, ctx.y ?? 1.2));
  if (ringPulseR) ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, ringPulseR, color));
  return null;
}

const _timeShiftCast = (ctx) => _clockSweep(ctx, 0.55, 1.4, -1, 0);
// timeShift's actual rewind resolves later ("timeshiftReturn") — a brighter,
// faster snap-back flash to sell the position rewind landing.
const _timeShiftImpact = (ctx) => _clockSweep(ctx, 0.35, 2.2, -1, 2.0);
const _pocketWatchCast = (ctx) => _clockSweep(ctx, 0.5, 1.6, 1, 2.0);
const _pocketWatchImpact = () => null;

// ---------------------------------------------------------------------------
// drain — the charge-steal sparkle: an inward spiral of spark shards at the
// drained target (cast) that converges into a bright flash at the caster
// (impact), matching the icon's spiral drain path + two dots.
// ---------------------------------------------------------------------------
function _drainCore(color) {
  return facetedDuo((c, o) => facetedOrb(0.24, c, o), color, {});
}

function _drainCast(ctx) {
  const color = ctx.color;
  const eff = _effect(0.5, (g, disposables) => {
    const n = 5;
    const shards = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const d = _duo(g, disposables, (c, o) => facetedShard(0.2, c, { sx: 0.2, sy: 0.08, sz: 0.08, transparent: true, ...o }), color, {}, 0, 1, 0);
      d.userData.a0 = a0;
      shards.push(d);
    }
    return (k) => {
      const r = 0.9 * (1 - k);
      for (const d of shards) {
        const a = d.userData.a0 + k * Math.PI * 3.4;
        d.position.set(Math.cos(a) * r, 1 + k * 0.3, Math.sin(a) * r);
        d.rotation.y = -a;
        _fadeDuo(d, Math.max(0, 1 - k));
        d.scale.setScalar(Math.max(0.15, 1 - k * 0.6));
      }
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  return null;
}

function _drainImpact(ctx) {
  const color = ctx.color;
  const eff = _effect(0.3, (g, disposables) => {
    const n = 5;
    const shards = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const d = _duo(g, disposables, (c, o) => facetedShard(0.2, c, { sx: 0.2, sy: 0.08, sz: 0.08, transparent: true, ...o }), brighten(color, 0.25), {}, 0, 1, 0);
      d.userData.a0 = a0;
      shards.push(d);
    }
    return (k) => {
      const r = 0.7 * (1 - k);
      for (const d of shards) {
        const a = d.userData.a0 - k * Math.PI * 2;
        d.position.set(Math.cos(a) * r, 1, Math.sin(a) * r);
        d.rotation.y = -a;
        _fadeDuo(d, Math.max(0, 1 - k));
      }
    };
  });
  eff.position.set(ctx.x, 0, ctx.z);
  ctx.addEffect(eff);
  ctx.addEffect(ctx.burstAt(ctx.x, ctx.z, brighten(color, 0.25), { count: 8, speed: 4, life: 0.3 }, ctx.y ?? 1.0));
  return null;
}

// ---------------------------------------------------------------------------
// Registry slice — merge into VFX_REGISTRY (src/vfx/duotone.js) by callers,
// e.g. `Object.assign(VFX_REGISTRY, UTILITY_VFX)`.
// ---------------------------------------------------------------------------
export const UTILITY_VFX = {
  teleport: { color: _spellColor("teleport", 0x3ad6ff), buildCore: _teleportCore, cast: _teleportCast, impact: _teleportImpact },
  blink: { color: _spellColor("blink", 0x66ccff), buildCore: _blinkCore, cast: _blinkCast, impact: _blinkImpact },
  swap: { color: _spellColor("swap", 0xe066ff), buildCore: _swapCore, cast: _swapCast, impact: _swapImpact },
  thrust: { color: _spellColor("thrust", 0xff6a44), buildCore: _thrustCore, cast: _thrustCast, impact: _thrustImpact },
  rush: { color: _spellColor("rush", 0xffa63c), buildCore: _rushCore, cast: _rushCast, impact: _rushImpact },
  windWalk: { color: _spellColor("windWalk", 0x8ff2c9), buildCore: _windWalkCore, cast: _windWalkCast, impact: _windWalkImpact },
  speed: { color: _spellColor("speed", 0xffd23c), buildCore: _speedCore, cast: _speedCast, impact: _speedImpact },
  shield: { color: _spellColor("shield", 0x7fe0ff), buildCore: _shieldCore, cast: _shieldCast, impact: _shieldImpact },
  heal: { color: _spellColor("heal", 0x7cff8a), buildCore: _healCore, cast: _healCast, impact: _healImpact },
  invisible: { color: _spellColor("invisible", 0x445577), buildCore: _invisibleCore, cast: _invisibleCast, impact: _invisibleImpact },
  summon: { color: _spellColor("summon", 0x9c7bff), buildCore: _summonCore, cast: _summonCast, impact: _summonImpact },
  timeShift: { color: _spellColor("timeShift", 0xc9a227), buildCore: _clockCore, cast: _timeShiftCast, impact: _timeShiftImpact },
  pocketWatch: { color: _spellColor("pocketWatch", 0xffe14c), buildCore: _clockCore, cast: _pocketWatchCast, impact: _pocketWatchImpact },
  drain: { color: _spellColor("drain", 0xaa2f6b), buildCore: _drainCore, cast: _drainCast, impact: _drainImpact },
};
