// Pure aim-mode-aware targeting for touch casts (no DOM/no THREE — safe to
// import from Node tests). Given a spell definition, the local player's pose,
// the current enemy roster, and the live arena bounds, computes the {tx, tz}
// world point to feed into the same cast-queue shape the mouse path uses
// (InputController.queueCast in src/input.js).
//
// Every archetype here is a *client-side estimate* only. For NEAREST_TARGET_LOCK
// and TETHER_LOCK spells the host re-derives its own real target from live
// positions (see nearestEnemy()/aimedEnemy() in src/spells.js) and ignores
// tx/tz entirely, so this function's job for those archetypes is just to send
// a reasonable point for the outgoing packet / any client-side preview — it is
// never authoritative over the actual cast resolution.

// Fallback aim distance for spells with no explicit `range` (e.g. fireball,
// thrust) — only the angle from the caster matters for direction-only
// archetypes, so the exact distance is inconsequential as long as it's finite
// and positive.
const DEFAULT_TOUCH_AIM_RANGE = 12;

function nearestAliveEnemy(pose, enemies, maxRange = Infinity) {
  let best = null, bestD = Infinity;
  for (const e of enemies || []) {
    if (!e || e.al === false || e.f || e.sp) continue;
    const d = Math.hypot(e.x - pose.x, e.z - pose.z);
    if (d > maxRange) continue;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// Clamps world point (tx,tz) to at most `range` units from (px,pz), keeping
// its direction. No-op if already in range or range isn't a finite distance.
function clampToRange(px, pz, tx, tz, range) {
  if (!Number.isFinite(range)) return { tx, tz };
  const dx = tx - px, dz = tz - pz;
  const d = Math.hypot(dx, dz);
  if (d <= range || d === 0) return { tx, tz };
  const s = range / d;
  return { tx: px + dx * s, tz: pz + dz * s };
}

/**
 * @param {object} spellDef - a SPELLS[id] entry (needs .aim, .range)
 * @param {{x:number,z:number,heading:number}} pose - local player world pose;
 *   heading is a radian angle using the same (dx=cos,dz=sin) convention as
 *   Player.aim / screenToAim() in src/renderer.js.
 * @param {Array<{id:any,x:number,z:number,al?:boolean,f?:boolean,sp?:boolean}>} enemies
 * @param {{radius:number}} [arena] - live arena bounds (e.g. {radius: snap.arenaR})
 * @returns {{tx:number, tz:number}}
 */
export function aimForTouchCast(spellDef, pose, enemies = [], arena = null) {
  const aim = spellDef?.aim;
  const px = pose?.x || 0;
  const pz = pose?.z || 0;
  const heading = Number.isFinite(pose?.heading) ? pose.heading : 0;
  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  const range = Number.isFinite(spellDef?.range) ? spellDef.range : DEFAULT_TOUCH_AIM_RANGE;

  if (aim === "SELF_BUFF" || aim === "SELF_AOE") {
    return { tx: px, tz: pz };
  }

  if (aim === "BLINK_MOVE_TO_POINT") {
    const arenaR = arena?.radius;
    if (Number.isFinite(arenaR) && arenaR > 0) {
      const distFromCenter = Math.hypot(px, pz);
      if (distFromCenter > 0.8 * arenaR) {
        // Recovery: near the shrinking edge, blink back toward the arena
        // center instead of continuing outward (which risks blinking off the
        // platform into the hazard).
        const s = Math.min(range, distFromCenter) / distFromCenter;
        return { tx: px - px * s, tz: pz - pz * s };
      }
    }
    return { tx: px + fx * range, tz: pz + fz * range };
  }

  if (aim === "NEAREST_TARGET_LOCK" || aim === "TETHER_LOCK") {
    const target = nearestAliveEnemy(pose, enemies, range * 1.25);
    if (target) return { tx: target.x, tz: target.z };
    return { tx: px + fx * range, tz: pz + fz * range };
  }

  if (aim === "GROUND_AOE_AT_POINT") {
    const target = nearestAliveEnemy(pose, enemies);
    if (target) return clampToRange(px, pz, target.x, target.z, range);
    return { tx: px + fx * range * 0.7, tz: pz + fz * range * 0.7 };
  }

  // DIRECTIONAL_PROJECTILE, CONE_SPRAY, DASH_IMPACT (and any unrecognized
  // aim mode): direction-only. The host only reads the angle atan2(tz-z,
  // tx-x) via aimToward() (src/spells.js), so any finite point along the
  // facing vector resolves the same cast.
  return { tx: px + fx * range, tz: pz + fz * range };
}
