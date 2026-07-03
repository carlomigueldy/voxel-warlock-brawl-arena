// Near-verbatim port of legacy renderer.js's `_processEvents(events)` (design
// §5) — the switch that turns one snapshot tick's `events` into VFX/SFX/
// screen-shake/animation-trigger dispatch. `this.*` calls become calls on an
// injected `EventFxCtx` so this stays a PURE function: no THREE.Scene, no
// snapshotRef, no entityRegistry import here — EffectsLayer's makeEventFxCtx
// is the only place those get wired to a concrete ctx, which is what makes
// this file trivially unit-testable with a hand-built mock ctx (see
// test/three/eventToEffects.test.ts).
//
// Every `case` below mirrors its renderer.js counterpart line-for-line,
// including defensive `?? 0`/`|| default` fallbacks that read redundant
// against GameEvent's typed (non-optional) fields — kept anyway so this
// stays a byte-for-byte port of the golden source rather than a
// reinterpretation of it (design §0: "any deviation = parity failure").
// The one deliberate omission is `cast`'s `ev.y`: spells.ts (grep-verified)
// never emits a `y` field on "cast" events, so GameEvent's typed variant
// correctly has none — legacy's `y: ev.y` was always `y: undefined` there.
import * as THREE from "three";
import { CFG, SPELLS, ITEMS } from "../../config.js";
import { VFX_REGISTRY, getVfx, type VfxCtx } from "../../vfx/duotone.js";
import { buildChainBeam } from "../../vfx/beams.js";
import { buildLightning, buildMeteor, buildStormClouds } from "../../voxel.js";
import type { GameEvent } from "../../types";
import type { BurstOpts } from "../fx/builders";

/** The seam eventToEffects.ts drives every VFX/SFX/shake/animation-trigger
 * call through — EffectsLayer's makeEventFxCtx is the sole real
 * implementation; tests construct a plain mock satisfying this shape.
 * `posForId`/`playerPos`/`colorForId` cover the three distinct position/
 * colour lookups legacy inlines ad hoc across the switch (see each case's
 * comment for which legacy helper it mirrors). */
export interface EventFxCtx {
  addEffect(effect: THREE.Object3D | null | undefined): void;
  /** Port of `_burstAt`/`buildBurst` (src/three/fx/builders.ts). */
  burstAt(x: number, z: number, color: number, opts?: BurstOpts, y?: number): THREE.Group;
  /** Port of `_ringPulse`. */
  ringPulse(x: number, z: number, radius: number, color: number): THREE.Object3D;
  /** Port of `_vfxCtx` — the ctx object VFX_REGISTRY entries' cast/impact expect. */
  vfxCtx(x: number, z: number, extra?: Record<string, unknown>): VfxCtx;
  /** `this.audio?.play(name, pan)`. */
  playSfx(name: string, pan?: number): void;
  /** Port of `_panFor`: `clamp(x/arenaR, -1, 1)`. */
  panFor(x: number): number;
  /** Port of the inline `this._shake = Math.min(cap, this._shake + add)`
   * pattern repeated at every impact site — each call clamps to its OWN
   * cap, never cumulative across different event kinds (design §0). */
  addShake(add: number, cap: number): void;
  /** Port of `_triggerCast` — fires on every event, before the switch. */
  triggerCast(ev: GameEvent): void;
  /** Port of `_triggerReaction` — fires on every event, before the switch. */
  triggerReaction(ev: GameEvent): void;
  /** Port of `_triggerMobAttackModel(mobId)` — "hit" only. */
  triggerMobAttack(mobId: string): void;
  /** Port of `_triggerMobAttackModelNear(mobType, x, z)` — "mobAbility" only. */
  triggerMobAttackNear(mobType: string, x: number, z: number): void;
  /** Port of `_posForId`: explicit x/z if given, else the caster's live
   * position, else `{0, 0}` — used by the buff-group case and pocketwatch
   * (whose own inline `pwMesh ? pos : 0` fallback is identical in shape). */
  posForId(id: string, x?: number, z?: number): { x: number; z: number };
  /** Raw nullable position lookup — "link" needs to know whether EACH
   * endpoint mesh actually exists (and skip that endpoint's burst if not),
   * unlike posForId's always-succeeds-with-{0,0} fallback; mirrors legacy's
   * direct `this.playerMeshes?.get(id)` presence check for that one case. */
  playerPos(id: string): { x: number; z: number } | undefined;
  /** Port of `effectPos(...).color`: the player's body colour, or `0xffffff`
   * when unknown — "death" is the only case that needs a colour-matched
   * burst for an id with no x/z on the event itself. */
  colorForId(id: string): number;
}

export function applyEvents(events: GameEvent[], ctx: EventFxCtx): void {
  for (const ev of events) {
    ctx.triggerCast(ev);
    ctx.triggerReaction(ev);
    switch (ev.type) {
      case "hit":
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, 0xffcc44, { count: 26, speed: 10 }));
        ctx.playSfx("hit", ctx.panFor(ev.x));
        ctx.addShake(0.22, 0.6);
        ctx.triggerMobAttack(ev.by);
        break;
      case "boltFizzle":
        // Projectile dispersed against cover — burst at the impact point,
        // tinted to the projectile colour, at the bolt's height (y).
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, ev.c || 0xffcc44, { count: 14, speed: 6, life: 0.4 }, ev.y ?? 1.0));
        ctx.playSfx("hit", ctx.panFor(ev.x));
        ctx.addShake(0.08, 0.4);
        break;
      case "projectileClash":
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, 0x9fe6ff, { count: 26, speed: 10, life: 0.45 }));
        ctx.addEffect(ctx.ringPulse(ev.x, ev.z, 2.2, 0xffffff));
        ctx.playSfx("projectileClash", ctx.panFor(ev.x));
        ctx.addShake(0.2, 0.7);
        break;
      case "death": {
        // Large colour-matched burst + ring pulse at the player's last
        // position — port of `effectPos(this.playerMeshes.get(ev.id))`.
        const pos = ctx.posForId(ev.id);
        const color = ctx.colorForId(ev.id);
        ctx.addEffect(ctx.burstAt(pos.x, pos.z, color, { count: 32, speed: 12, life: 0.9 }));
        ctx.addEffect(ctx.ringPulse(pos.x, pos.z, 2.5, color));
        ctx.playSfx("death");
        ctx.addShake(0.3, 0.8);
        break;
      }
      case "cast": {
        // Call the registry's bespoke cast() when VFX_REGISTRY has an entry
        // for this spell (getVfx()'s color already covers spells with no
        // bespoke entry yet); some entries deliberately opt out of an extra
        // cast burst (fireball/boomerang/homing/bouncer/splitter) so only the
        // true no-entry case falls back to the old generic burst.
        const vfx = getVfx(ev.spell);
        const entry = VFX_REGISTRY[ev.spell];
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(ev.x, ev.z, { color: vfx.color }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.burstAt(ev.x, ev.z, vfx.color, { count: 14, speed: 6, life: 0.35 }));
        }
        break;
      }
      case "lightning": {
        // Initial zap flare at the caster (first segment's origin), then the
        // jagged duotone chain-arc look for every hop.
        const vfx = getVfx("lightning");
        const color = ev.color || vfx.color;
        const segs = ev.segs || [];
        const entry = VFX_REGISTRY.lightning;
        if (entry && segs.length) {
          const eff = entry.cast(ctx.vfxCtx(segs[0].x1, segs[0].z1, { color }));
          if (eff) ctx.addEffect(eff);
        }
        for (const s of segs) ctx.addEffect(buildChainBeam(s.x1, s.z1, s.x2, s.z2, color));
        // SFX handled by the sfx relay (redundant direct play removed — C7).
        break;
      }
      case "teleport": {
        // teleport and blink share this event, so both always render as the
        // "teleport" duotone — matches the previous identical-burst-for-both
        // behavior.
        const vfx = getVfx("teleport");
        const entry = VFX_REGISTRY.teleport;
        if (entry) {
          const departEff = entry.cast(ctx.vfxCtx(ev.x1, ev.z1, { color: vfx.color }));
          if (departEff) ctx.addEffect(departEff);
          const arriveEff = entry.impact(ctx.vfxCtx(ev.x2, ev.z2, { color: vfx.color }));
          if (arriveEff) ctx.addEffect(arriveEff);
        } else {
          ctx.addEffect(ctx.burstAt(ev.x1, ev.z1, vfx.color, { count: 14 }));
          ctx.addEffect(ctx.burstAt(ev.x2, ev.z2, vfx.color, { count: 14 }));
        }
        break;
      }
      case "thrust": {
        const vfx = getVfx("thrust");
        const entry = VFX_REGISTRY.thrust;
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(ev.x, ev.z, { color: vfx.color }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.burstAt(ev.x, ev.z, vfx.color, { count: 8, speed: 5 }));
        }
        break;
      }
      case "swap": {
        const vfx = getVfx("swap");
        const entry = VFX_REGISTRY.swap;
        if (entry) {
          const effA = entry.cast(ctx.vfxCtx(ev.ax, ev.az, { color: vfx.color }));
          if (effA) ctx.addEffect(effA);
          const effB = entry.impact(ctx.vfxCtx(ev.bx, ev.bz, { color: vfx.color }));
          if (effB) ctx.addEffect(effB);
        } else {
          ctx.addEffect(ctx.burstAt(ev.ax, ev.az, vfx.color, { count: 12 }));
          ctx.addEffect(ctx.burstAt(ev.bx, ev.bz, vfx.color, { count: 12 }));
        }
        break;
      }
      case "drain": {
        const vfx = getVfx("drain");
        const entry = VFX_REGISTRY.drain;
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(ev.x1, ev.z1, { color: vfx.color, x2: ev.x2, z2: ev.z2 }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(buildLightning(ev.x1, ev.z1, ev.x2, ev.z2, vfx.color));
        }
        break;
      }
      case "gravity": {
        const vfx = getVfx("gravity");
        const entry = VFX_REGISTRY.gravity;
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(ev.x, ev.z, { color: vfx.color, radius: ev.radius }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.ringPulse(ev.x, ev.z, ev.radius, vfx.color));
        }
        ctx.playSfx("gravity", ctx.panFor(ev.x));
        break;
      }
      case "meteorCast": {
        // Timed ground decal: a ring at the target that pulses faster as the
        // meteor falls — a self-spawning controller group that calls
        // ctx.addEffect(ctx.ringPulse(...)) itself over time, ported
        // one-for-one (design §5).
        const vfx = getVfx("meteor");
        const entry = VFX_REGISTRY.meteor;
        const fallDur = ev.fall || 1.0;
        const decalR = ev.radius || 7;
        const decalEff = new THREE.Group();
        let decalElapsed = 0;
        let decalNext = 0;
        decalEff.userData.done = false;
        decalEff.userData.update = (dt: number) => {
          decalElapsed += dt;
          const k = Math.min(1, decalElapsed / fallDur);
          const interval = 0.35 * (1 - k * 0.6); // pulses accelerate toward impact
          if (decalElapsed >= decalNext) {
            decalNext += interval;
            ctx.addEffect(ctx.ringPulse(ev.x, ev.z, decalR * (0.6 + 0.4 * k), vfx.color));
          }
          if (decalElapsed >= fallDur + 0.05) decalEff.userData.done = true;
        };
        ctx.addEffect(decalEff);
        // Bespoke ignition-spark accent alongside the synced fall telegraph above.
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(ev.x, ev.z, { color: vfx.color }));
          if (eff) ctx.addEffect(eff);
        }
        ctx.playSfx("meteor", ctx.panFor(ev.x));
        break;
      }
      case "meteorImpact": {
        const vfx = getVfx("meteor");
        const entry = VFX_REGISTRY.meteor;
        if (entry) {
          const eff = entry.impact(ctx.vfxCtx(ev.x, ev.z, { color: vfx.color, radius: ev.radius }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.burstAt(ev.x, ev.z, vfx.color, { count: 40, speed: 12, life: 0.7 }));
          ctx.addEffect(ctx.ringPulse(ev.x, ev.z, ev.radius, vfx.color));
        }
        ctx.playSfx("meteorImpact", ctx.panFor(ev.x));
        ctx.addShake(0.8, 1.0);
        break;
      }
      case "castStart":
        ctx.addEffect(ctx.ringPulse(ev.x ?? 0, ev.z ?? 0, 1.5, SPELLS[ev.spell]?.color ?? 0x88ddff));
        ctx.playSfx("whoosh", ctx.panFor(ev.x ?? 0));
        break;
      case "castInterrupt":
        ctx.addEffect(ctx.burstAt(ev.x ?? 0, ev.z ?? 0, 0xff4444, { count: 10, speed: 5, life: 0.35 }));
        ctx.playSfx("hit", ctx.panFor(ev.x || 0));
        ctx.addShake(0.08, 0.4);
        break;
      case "castFinish":
        ctx.addEffect(ctx.burstAt(ev.x ?? 0, ev.z ?? 0, 0xffffff, { count: 6, speed: 4, life: 0.25 }));
        ctx.playSfx("whoosh", ctx.panFor(ev.x ?? 0));
        break;
      case "explode": {
        const vfx = getVfx("explode");
        const entry = VFX_REGISTRY.explode;
        if (entry) {
          const eff = entry.impact(ctx.vfxCtx(ev.x, ev.z, { color: vfx.color, radius: ev.radius }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.burstAt(ev.x, ev.z, vfx.color, { count: 40, speed: 12, life: 0.7 }));
          ctx.addEffect(ctx.ringPulse(ev.x, ev.z, ev.radius, vfx.color));
        }
        ctx.playSfx("meteorImpact", ctx.panFor(ev.x));
        ctx.addShake(0.6, 1.0);
        break;
      }
      case "vacuumTick": {
        const vfx = getVfx("vacuum");
        const entry = VFX_REGISTRY.vacuum;
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(ev.x, ev.z, { color: vfx.color, radius: ev.radius }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.ringPulse(ev.x, ev.z, ev.radius, vfx.color));
        }
        break;
      }
      case "pull": {
        const vfx = getVfx("pull");
        const entry = VFX_REGISTRY.pull;
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(ev.x1, ev.z1, { color: vfx.color, x2: ev.x2, z2: ev.z2 }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(buildLightning(ev.x1, ev.z1, ev.x2, ev.z2, vfx.color));
        }
        break;
      }
      case "drag": {
        const vfx = getVfx("drag");
        const entry = VFX_REGISTRY.drag;
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(ev.x1, ev.z1, { color: vfx.color, x2: ev.x2, z2: ev.z2 }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(buildLightning(ev.x1, ev.z1, ev.x2, ev.z2, vfx.color));
        }
        break;
      }
      case "push": {
        const vfx = getVfx("push");
        const entry = VFX_REGISTRY.push;
        if (entry) {
          const eff = entry.impact(ctx.vfxCtx(ev.x, ev.z, { color: vfx.color, angle: ev.dir }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.burstAt(ev.x, ev.z, vfx.color, { count: 14, speed: 8, life: 0.4 }));
        }
        break;
      }
      case "target": {
        // Doom has no separate windup/telegraph event — the single "target"
        // event covers both the cast and the hit in one packet — so fire the
        // registry's cast() alongside impact() rather than impact() alone;
        // both simply ctx.addEffect() internally and return null, so there
        // is nothing to double-add here.
        const vfx = getVfx("target");
        const entry = VFX_REGISTRY.target;
        if (entry) {
          const vctx = ctx.vfxCtx(ev.x, ev.z, { color: vfx.color });
          entry.cast(vctx);
          const eff = entry.impact(vctx);
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.burstAt(ev.x, ev.z, vfx.color, { count: 16, speed: 7, life: 0.45 }));
        }
        break;
      }
      case "heal": {
        const vfx = getVfx("heal");
        const entry = VFX_REGISTRY.heal;
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(ev.x, ev.z, { color: vfx.color }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.burstAt(ev.x, ev.z, vfx.color, { count: 6, speed: 3, life: 0.4 }));
        }
        break;
      }
      case "link": {
        // Link tether cast: the registry's steady beam spans both ends
        // (caster a, target b) for the tether's actual duration; falls back
        // to the old twin-burst look when no live mesh exists yet — and,
        // unlike posForId's cases, an ABSENT endpoint is skipped entirely
        // rather than bursting at a {0,0} fallback (ctx.playerPos, not
        // ctx.posForId — see the interface doc comment).
        const vfx = getVfx("link");
        const entry = VFX_REGISTRY.link;
        const aPos = ctx.playerPos(ev.a);
        const bPos = ctx.playerPos(ev.b);
        if (entry && aPos && bPos) {
          const eff = entry.cast(ctx.vfxCtx(aPos.x, aPos.z, {
            color: vfx.color,
            x2: bPos.x, z2: bPos.z,
            duration: SPELLS.link?.duration,
          }));
          if (eff) ctx.addEffect(eff);
        } else {
          if (aPos) ctx.addEffect(ctx.burstAt(aPos.x, aPos.z, vfx.color, { count: 14, speed: 7, life: 0.45 }));
          if (bPos) ctx.addEffect(ctx.burstAt(bPos.x, bPos.z, vfx.color, { count: 14, speed: 7, life: 0.45 }));
        }
        break;
      }
      case "pocketwatch": {
        // Pocket Watch: golden clock-sweep at the caster. Legacy inlines an
        // identical `pwMesh ? pos : {0,0}` fallback rather than calling
        // _posForId — same shape, so ctx.posForId(ev.id) alone covers it.
        const vfx = getVfx("pocketWatch");
        const entry = VFX_REGISTRY.pocketWatch;
        const pos = ctx.posForId(ev.id);
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(pos.x, pos.z, { color: vfx.color }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.burstAt(pos.x, pos.z, vfx.color, { count: 20, speed: 8, life: 0.5 }));
          ctx.addEffect(ctx.ringPulse(pos.x, pos.z, 2.0, vfx.color));
        }
        break;
      }
      case "timeshiftReturn": {
        const vfx = getVfx("timeShift");
        const entry = VFX_REGISTRY.timeShift;
        if (entry) {
          const eff = entry.impact(ctx.vfxCtx(ev.x ?? 0, ev.z ?? 0, { color: vfx.color }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.burstAt(ev.x ?? 0, ev.z ?? 0, vfx.color, { count: 10 }));
        }
        ctx.playSfx("timeshift", ctx.panFor(ev.x ?? 0));
        break;
      }
      case "invisible":
      case "speed":
      case "summon":
      case "shield":
      case "windwalk":
      case "rush":
      case "timeshift": {
        // Casing note: a few event `type`s don't match their SPELLS/
        // VFX_REGISTRY key casing (windwalk -> windWalk, timeshift ->
        // timeShift) — map explicitly rather than assuming a shared name.
        const spellId = ({ windwalk: "windWalk", timeshift: "timeShift" } as Record<string, string>)[ev.type] || ev.type;
        const vfx = getVfx(spellId);
        const entry = VFX_REGISTRY[spellId];
        // Only "summon"/"timeshift" carry x/z on the wire; the rest rely
        // entirely on posForId's live-mesh fallback (mirrors legacy's plain
        // `ev.x, ev.z` reads, which are `undefined` for the other five).
        const evX = "x" in ev ? ev.x : undefined;
        const evZ = "z" in ev ? ev.z : undefined;
        const pos = ctx.posForId(ev.id, evX, evZ);
        if (entry) {
          const eff = entry.cast(ctx.vfxCtx(pos.x, pos.z, { color: vfx.color }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.burstAt(pos.x, pos.z, vfx.color, { count: 10 }));
        }
        break;
      }
      case "runePickup":
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, 0x7cff5a, { count: 18, speed: 6 }));
        ctx.playSfx("cast", ctx.panFor(ev.x || 0));
        break;
      case "itemPickup": {
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, 0xffd23c, { count: 20, speed: 7, life: 0.5 }));
        ctx.addEffect(ctx.ringPulse(ev.x, ev.z, 1.8, 0xffd23c));
        const rarity = ITEMS[ev.itemKey]?.rarity;
        if (rarity === "common") ctx.playSfx("pickupCommon", ctx.panFor(ev.x || 0));
        else if (rarity === "rare") ctx.playSfx("pickupRare", ctx.panFor(ev.x || 0));
        else ctx.playSfx("cast", ctx.panFor(ev.x || 0));
        break;
      }
      case "jump":
        ctx.playSfx("jump", ctx.panFor(ev.x || 0));
        break;
      case "land":
        ctx.playSfx(ev.hard ? "landHard" : "landSoft", ctx.panFor(ev.x || 0));
        break;
      case "footstep":
        ctx.playSfx("footstepStone", ctx.panFor(ev.x || 0));
        break;
      case "lowHealth":
        ctx.playSfx("lowHealth", ctx.panFor(ev.x || 0));
        break;
      case "shieldBlock":
        ctx.playSfx("shieldBlock", ctx.panFor(ev.x || 0));
        break;
      case "runeDestroyed":
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, 0xff3a1e, { count: 22, speed: 8, life: 0.6 }));
        ctx.addEffect(ctx.ringPulse(ev.x, ev.z, 2.5, 0xff3a1e));
        ctx.playSfx("hit", ctx.panFor(ev.x || 0));
        break;
      case "statusApplied": {
        const statusCol = ({ slow: 0x66ccff, burn: 0xff7a2e, curse: 0x9c2bff, stun: 0xffe14c } as Record<string, number>)[ev.status] || 0xffffff;
        if (ev.status === "stun" && VFX_REGISTRY.stun) {
          // Hex Bash (and any mob ability applying the same "stun" status)
          // emits no dedicated cast/hit event of its own — this
          // statusApplied packet is the only signal — so route it through
          // the registry's converging zigzag echo of stun's icon instead of
          // a generic ring.
          const eff = VFX_REGISTRY.stun.impact(ctx.vfxCtx(ev.x, ev.z, { color: statusCol }));
          if (eff) ctx.addEffect(eff);
        } else {
          ctx.addEffect(ctx.ringPulse(ev.x, ev.z, 1.8, statusCol));
        }
        ctx.playSfx(ev.status, ctx.panFor(ev.x));
        break;
      }
      case "dotTick":
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, 0xff7a2e, { count: 5, speed: 3, life: 0.3 }));
        ctx.playSfx("burn", ctx.panFor(ev.x));
        break;
      case "sfx":
        ctx.playSfx(ev.sfx, ctx.panFor(ev.x || 0));
        break;
      // "mobSpawn" is emitted ONLY by minions (big mobs emit "mobIncoming"
      // instead). This handler stays for the small burst+ring on minion spawn.
      case "mobSpawn":
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, ev.color || 0xaaaaaa, { count: 16, speed: 7, life: 0.6 }));
        ctx.addEffect(ctx.ringPulse(ev.x, ev.z, 2.0, ev.color || 0xaaaaaa));
        ctx.playSfx("whoosh", ctx.panFor(ev.x));
        break;
      // Big-mob cinematic entrance begins. ev.entrance is the kind key from
      // CFG.MOB_TYPES[type].entrance.kind.
      case "mobIncoming": {
        switch (ev.entrance) {
          case "shatter": {
            // Stone Giant: rocky debris burst in grey/brown + dust ring.
            ctx.addEffect(ctx.burstAt(ev.x, ev.z, 0x888888, { count: 24, speed: 8, life: 0.9 }, 0.3));
            ctx.addEffect(ctx.burstAt(ev.x, ev.z, 0x553322, { count: 14, speed: 5, life: 1.1 }, 0.1));
            ctx.addEffect(ctx.ringPulse(ev.x, ev.z, 3.5, 0x888888));
            ctx.playSfx("hit", ctx.panFor(ev.x));
            ctx.addShake(0.2, 0.5);
            break;
          }
          case "storm": {
            // Storming Vortex: hovering storm clouds + two crossing lightning
            // strikes + ground ring with a blue electric accent.
            ctx.addEffect(buildStormClouds(ev.x, ev.z));
            ctx.addEffect(buildLightning(ev.x - 2, ev.z - 1, ev.x, ev.z + 0.5, 0x7adfff));
            ctx.addEffect(buildLightning(ev.x + 2, ev.z - 1, ev.x, ev.z + 0.5, 0x9fe6ff));
            ctx.addEffect(ctx.ringPulse(ev.x, ev.z, 3.0, 0x7adfff));
            ctx.playSfx("lightning", ctx.panFor(ev.x));
            ctx.addShake(0.12, 0.4);
            break;
          }
          case "summon": {
            // Giant Dwarf: repeating expanding ground ring pulses timed to
            // the entrance window, plus an initial debris burst.
            const summonDuration = ev.duration || CFG.MOB_ENTRANCE || 2.5;
            const pulseEff = new THREE.Group();
            let pElapsed = 0;
            let pNext = 0;
            const pInterval = 0.55;
            pulseEff.userData.done = false;
            pulseEff.userData.update = (dt: number) => {
              pElapsed += dt;
              if (pElapsed >= pNext) {
                pNext += pInterval;
                ctx.addEffect(ctx.ringPulse(ev.x, ev.z, 4.5, 0xffd23c));
              }
              if (pElapsed >= summonDuration + 0.2) pulseEff.userData.done = true;
            };
            ctx.addEffect(pulseEff);
            ctx.addEffect(ctx.burstAt(ev.x, ev.z, 0xc47a2e, { count: 18, speed: 6, life: 0.8 }, 0.1));
            ctx.playSfx("whoosh", ctx.panFor(ev.x));
            ctx.addShake(0.15, 0.45);
            break;
          }
          case "meteor": {
            // Fire Elemental: a falling flaming rock that descends toward
            // the spawn point over the full entrance duration, driven by
            // elapsed time.
            const metDuration = ev.duration || CFG.MOB_ENTRANCE || 2.5;
            const metEff = buildMeteor(ev.x, ev.z, metDuration, 4, 0xff5a1e);
            let metElapsed = 0;
            const origMetUpdate = metEff.userData.update;
            metEff.userData.done = false;
            metEff.userData.update = (dt: number) => {
              metElapsed = Math.min(metElapsed + dt, metDuration);
              origMetUpdate(dt, metDuration - metElapsed);
              if (metElapsed >= metDuration) metEff.userData.done = true;
            };
            ctx.addEffect(metEff);
            ctx.playSfx("meteorImpact", ctx.panFor(ev.x));
            ctx.addShake(0.1, 0.3);
            break;
          }
          // "none" (or any other kind): no case, no VFX — matches legacy's
          // switch, which also has no default.
        }
        break;
      }
      // Big-mob entrance window ends: shockwave impact at spawn point.
      case "mobArrive": {
        const arriveKind = CFG.MOB_TYPES?.[ev.mobType]?.entrance?.kind || "";
        const bigImpact = arriveKind === "meteor" || arriveKind === "summon";
        const arriveColor =
          ev.mobType === "stoneGiant" ? 0x888888 :
          ev.mobType === "stormingVortex" ? 0x7adfff :
          ev.mobType === "giantDwarf" ? 0xffd23c :
          ev.mobType === "fireElemental" ? 0xff5a1e : 0xaaaaaa;
        ctx.addEffect(ctx.burstAt(
          ev.x, ev.z, arriveColor,
          { count: bigImpact ? 32 : 20, speed: bigImpact ? 11 : 8, life: 0.7 },
          0.5,
        ));
        ctx.addEffect(ctx.ringPulse(
          ev.x, ev.z,
          bigImpact ? Math.max(ev.radius || 0, 5) : 3.0,
          arriveColor,
        ));
        ctx.addShake(bigImpact ? 0.5 : 0.3, 1.0);
        ctx.playSfx(bigImpact ? "meteorImpact" : "hit", ctx.panFor(ev.x));
        break;
      }
      case "mobHit":
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, 0xffaa44, { count: 10, speed: 5 }));
        ctx.playSfx("hit", ctx.panFor(ev.x));
        ctx.addShake(0.07, 0.4);
        break;
      case "mobTelegraph": {
        // Growing ground-warning ring that persists for the ability's
        // cast-time window, a self-spawning controller like meteorCast's decal.
        const telDuration = ev.castTime || 1.0;
        const telColor = ev.color || 0xff8800;
        const telRadius = ev.radius || 4;
        const telEff = new THREE.Group();
        let telElapsed = 0;
        telEff.userData.done = false;
        telEff.userData.update = (dt: number) => {
          telElapsed += dt;
          const k = Math.min(1, telElapsed / telDuration);
          // Pulse a growing ring each 0.25s during the windup.
          if (telElapsed % 0.25 < dt) {
            ctx.addEffect(ctx.ringPulse(ev.x, ev.z, telRadius * (0.4 + 0.6 * k), telColor));
          }
          if (telElapsed >= telDuration + 0.05) telEff.userData.done = true;
        };
        ctx.addEffect(telEff);
        ctx.playSfx("whoosh", ctx.panFor(ev.x));
        break;
      }
      case "mobAbility": {
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, ev.color || 0xff3a1e, { count: 22, speed: 9, life: 0.65 }, 0.6));
        ctx.addEffect(ctx.ringPulse(ev.x, ev.z, ev.radius || 4, ev.color || 0xff3a1e));
        // Dispatch SFX by ability type for better audio feedback.
        const abilitySfx = ({
          seismicStomp: "hit", vacuum: "gravity", fissureSlam: "meteorImpact", magmaEruption: "meteorImpact",
        } as Record<string, string>)[ev.ability] || "meteorImpact";
        ctx.playSfx(abilitySfx, ctx.panFor(ev.x));
        ctx.addShake(0.32, 0.9);
        ctx.triggerMobAttackNear(ev.mobType, ev.x, ev.z);
        break;
      }
      case "mobDeath":
        ctx.addEffect(ctx.burstAt(ev.x, ev.z, ev.color || 0xaaaaaa, { count: 30, speed: 9, life: 0.8 }, 1.0));
        ctx.addEffect(ctx.ringPulse(ev.x, ev.z, 3.0, ev.color || 0xffffff));
        ctx.playSfx("death", ctx.panFor(ev.x));
        ctx.addShake(0.28, 0.8);
        break;
    }
  }
}
