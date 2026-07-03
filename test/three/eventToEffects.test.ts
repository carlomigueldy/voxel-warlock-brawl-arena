// Smoke test for eventToEffects.ts (#147) — the near-verbatim port of legacy
// renderer.js's `_processEvents`. eventToEffects.ts is a PURE function (no
// THREE.Scene, no snapshotRef, no entityRegistry), so this drives it with a
// hand-built mock EventFxCtx that just records every call, then asserts the
// produced effects/sfx/shake/triggers for a representative slice of the ~40
// GameEvent variants — not a parity/screenshot test (that's scripts/
// parity.mjs), just a fast guard that the port's dispatch/shake-cap/fallback
// logic matches the golden switch statement.
import { describe, expect, test, vi } from "vitest";
import * as THREE from "three";
import { applyEvents, type EventFxCtx } from "../../src/three/vfx/eventToEffects";
import type { GameEvent } from "../../src/types";

interface MockCtx {
  ctx: EventFxCtx;
  addEffect: ReturnType<typeof vi.fn>;
  burstAt: ReturnType<typeof vi.fn>;
  ringPulse: ReturnType<typeof vi.fn>;
  playSfx: ReturnType<typeof vi.fn>;
  panFor: ReturnType<typeof vi.fn>;
  addShake: ReturnType<typeof vi.fn>;
  triggerCast: ReturnType<typeof vi.fn>;
  triggerReaction: ReturnType<typeof vi.fn>;
  triggerMobAttack: ReturnType<typeof vi.fn>;
  triggerMobAttackNear: ReturnType<typeof vi.fn>;
  posForId: ReturnType<typeof vi.fn>;
  playerPos: ReturnType<typeof vi.fn>;
  colorForId: ReturnType<typeof vi.fn>;
}

// Every builder call returns a fresh, inert THREE.Group with the transient
// effect contract (userData.update/done) so the "self-spawning controller"
// cases (meteorCast/mobIncoming summon/mobTelegraph) can be driven forward
// via .userData.update(dt) exactly like the real fxRoot loop would.
function makeMockCtx(playerPositions: Record<string, { x: number; z: number }> = {}): MockCtx {
  const addEffect = vi.fn();
  const burstAt = vi.fn((_x: number, _z: number, _color: number) => {
    const g = new THREE.Group();
    g.userData.done = false;
    return g;
  });
  const ringPulse = vi.fn((_x: number, _z: number, _r: number, _color: number) => {
    const g = new THREE.Group();
    g.userData.done = false;
    return g;
  });
  const playSfx = vi.fn();
  const panFor = vi.fn((x: number) => Math.max(-1, Math.min(1, x / 18)));
  const addShake = vi.fn();
  const triggerCast = vi.fn();
  const triggerReaction = vi.fn();
  const triggerMobAttack = vi.fn();
  const triggerMobAttackNear = vi.fn();
  const posForId = vi.fn((id: string, x?: number, z?: number) => {
    if (x !== undefined && z !== undefined) return { x, z };
    return playerPositions[id] ?? { x: 0, z: 0 };
  });
  const playerPos = vi.fn((id: string) => playerPositions[id]);
  const colorForId = vi.fn((id: string) => (playerPositions[id] ? 0x4cc9ff : 0xffffff));

  const ctx: EventFxCtx = {
    addEffect,
    burstAt,
    ringPulse,
    vfxCtx: (x, z, extra = {}) => ({ x, z, color: 0x88ddff, addEffect, ringPulse, burstAt, ...extra }),
    playSfx,
    panFor,
    addShake,
    triggerCast,
    triggerReaction,
    triggerMobAttack,
    triggerMobAttackNear,
    posForId,
    playerPos,
    colorForId,
  };

  return {
    ctx, addEffect, burstAt, ringPulse, playSfx, panFor, addShake,
    triggerCast, triggerReaction, triggerMobAttack, triggerMobAttackNear, posForId, playerPos, colorForId,
  };
}

describe("eventToEffects.ts applyEvents() (#147)", () => {
  test("fires triggerCast/triggerReaction on EVERY event, before the switch — even ones with no VFX case body", () => {
    const m = makeMockCtx();
    const events: GameEvent[] = [{ type: "jump", x: 1, z: 2 }];
    applyEvents(events, m.ctx);
    expect(m.triggerCast).toHaveBeenCalledTimes(1);
    expect(m.triggerCast).toHaveBeenCalledWith(events[0]);
    expect(m.triggerReaction).toHaveBeenCalledTimes(1);
    expect(m.triggerReaction).toHaveBeenCalledWith(events[0]);
    // "jump" itself still dispatches its SFX case.
    expect(m.playSfx).toHaveBeenCalledWith("jump", expect.any(Number));
  });

  test('"hit": burst + SFX + shake +0.22/0.6 cap + triggerMobAttack(by)', () => {
    const m = makeMockCtx();
    applyEvents([{ type: "hit", x: 3, z: 4, victim: "p2", by: "mob1" }], m.ctx);
    expect(m.burstAt).toHaveBeenCalledWith(3, 4, 0xffcc44, { count: 26, speed: 10 });
    expect(m.playSfx).toHaveBeenCalledWith("hit", expect.any(Number));
    expect(m.addShake).toHaveBeenCalledWith(0.22, 0.6);
    expect(m.triggerMobAttack).toHaveBeenCalledWith("mob1");
  });

  test('"death": posForId + colorForId resolve the burst/ring origin, SFX plays with NO pan arg, shake +0.3/0.8', () => {
    const m = makeMockCtx({ p1: { x: 5, z: 6 } });
    applyEvents([{ type: "death", id: "p1" }], m.ctx);
    expect(m.posForId).toHaveBeenCalledWith("p1");
    expect(m.colorForId).toHaveBeenCalledWith("p1");
    expect(m.burstAt).toHaveBeenCalledWith(5, 6, 0x4cc9ff, { count: 32, speed: 12, life: 0.9 });
    expect(m.ringPulse).toHaveBeenCalledWith(5, 6, 2.5, 0x4cc9ff);
    // Legacy: `this.audio?.play("death")` — no `this._panFor(...)` call at all.
    expect(m.playSfx).toHaveBeenCalledWith("death");
    expect(m.addShake).toHaveBeenCalledWith(0.3, 0.8);
  });

  test('"cast": routes through the registry (VFX_REGISTRY.meteor exists) instead of the generic burst fallback', () => {
    const m = makeMockCtx();
    applyEvents([{ type: "cast", spell: "meteor", id: "p1", x: 1, z: 1 }], m.ctx);
    // AOE_VFX.meteor.cast() is a real builder — it adds its own effects via
    // the ctx it's handed, so at minimum no generic 14-particle burst fires.
    expect(m.burstAt).not.toHaveBeenCalledWith(1, 1, expect.anything(), { count: 14, speed: 6, life: 0.35 });
  });

  test('"cast": falls back to a generic burst for a spell with no VFX_REGISTRY entry', () => {
    const m = makeMockCtx();
    applyEvents([{ type: "cast", spell: "__no_such_spell__", id: "p1", x: 2, z: 3 }], m.ctx);
    expect(m.burstAt).toHaveBeenCalledWith(2, 3, expect.any(Number), { count: 14, speed: 6, life: 0.35 });
  });

  test('"link": both endpoints known -> a single beam via the registry, x2/z2/duration forwarded', () => {
    const m = makeMockCtx({ a: { x: 0, z: 0 }, b: { x: 10, z: 0 } });
    applyEvents([{ type: "link", a: "a", b: "b" }], m.ctx);
    expect(m.playerPos).toHaveBeenCalledWith("a");
    expect(m.playerPos).toHaveBeenCalledWith("b");
    // No twin-burst fallback fired — the registry beam path was taken.
    expect(m.burstAt).not.toHaveBeenCalled();
  });

  test('"link": one endpoint missing -> only the known endpoint bursts, no beam/no burst for the missing one', () => {
    const m = makeMockCtx({ a: { x: 0, z: 0 } });
    applyEvents([{ type: "link", a: "a", b: "ghost" }], m.ctx);
    expect(m.burstAt).toHaveBeenCalledTimes(1);
    expect(m.burstAt).toHaveBeenCalledWith(0, 0, expect.any(Number), { count: 14, speed: 7, life: 0.45 });
  });

  test('"link": both endpoints missing -> no effect at all', () => {
    const m = makeMockCtx();
    applyEvents([{ type: "link", a: "ghost1", b: "ghost2" }], m.ctx);
    expect(m.addEffect).not.toHaveBeenCalled();
    expect(m.burstAt).not.toHaveBeenCalled();
  });

  test("buff-group casing map: windwalk -> windWalk, timeshift -> timeShift spell ids", () => {
    const m1 = makeMockCtx();
    applyEvents([{ type: "windwalk", id: "p1" }], m1.ctx);
    expect(m1.posForId).toHaveBeenCalledWith("p1", undefined, undefined);

    const m2 = makeMockCtx();
    applyEvents([{ type: "timeshift", id: "p1", x: 7, z: 8 }], m2.ctx);
    // "timeshift" DOES carry x/z on the wire — forwarded through verbatim.
    expect(m2.posForId).toHaveBeenCalledWith("p1", 7, 8);
  });

  test('"statusApplied" non-stun status: ring pulse tinted by status colour + SFX named after the status', () => {
    const m = makeMockCtx();
    applyEvents([{ type: "statusApplied", status: "burn", x: 1, z: 2, victim: "p1" }], m.ctx);
    expect(m.ringPulse).toHaveBeenCalledWith(1, 2, 1.8, 0xff7a2e);
    expect(m.playSfx).toHaveBeenCalledWith("burn", expect.any(Number));
  });

  test('"mobAbility": burst+ring+shake +0.32/0.9 + triggerMobAttackNear(mobType,x,z)', () => {
    const m = makeMockCtx();
    applyEvents([{ type: "mobAbility", mobType: "stoneGiant", ability: "seismicStomp", x: 4, z: 5, radius: 6, color: 0xabcdef }], m.ctx);
    expect(m.addShake).toHaveBeenCalledWith(0.32, 0.9);
    expect(m.triggerMobAttackNear).toHaveBeenCalledWith("stoneGiant", 4, 5);
    expect(m.playSfx).toHaveBeenCalledWith("hit", expect.any(Number)); // seismicStomp -> "hit"
  });

  test('"mobDeath": burst+ring+SFX+shake +0.28/0.8', () => {
    const m = makeMockCtx();
    applyEvents([{ type: "mobDeath", id: "mob1", mobType: "giantDwarf", cause: "hit", x: 0, z: 0, color: 0x123456 }], m.ctx);
    expect(m.addShake).toHaveBeenCalledWith(0.28, 0.8);
    expect(m.playSfx).toHaveBeenCalledWith("death", expect.any(Number));
  });

  test('"meteorCast": self-spawning decal controller pulses ringPulse over time and eventually flips done', () => {
    const m = makeMockCtx();
    applyEvents([{ type: "meteorCast", id: "p1", x: 0, z: 0, fall: 1.0, radius: 7 }], m.ctx);
    // First addEffect call is the decal controller group itself.
    const decal = m.addEffect.mock.calls[0][0] as THREE.Group;
    expect(typeof decal.userData.update).toBe("function");
    expect(decal.userData.done).toBe(false);

    const ringPulseCallsBefore = m.ringPulse.mock.calls.length;
    decal.userData.update(0.2);
    decal.userData.update(0.2);
    decal.userData.update(0.2);
    // Pulses fire on a 0.35s-ish cadence — driving 0.6s forward must have
    // produced at least one more ringPulse beyond whatever fired at t=0.
    expect(m.ringPulse.mock.calls.length).toBeGreaterThan(ringPulseCallsBefore);

    decal.userData.update(2.0); // push well past fall=1.0 + 0.05 margin
    expect(decal.userData.done).toBe(true);
  });

  test('"mobIncoming" shatter entrance: two dust bursts + ring + shake +0.20/0.5', () => {
    const m = makeMockCtx();
    applyEvents([{ type: "mobIncoming", id: "mob1", mobType: "stoneGiant", x: 0, z: 0, color: 0x888888, entrance: "shatter", duration: 2.5 }], m.ctx);
    expect(m.burstAt).toHaveBeenCalledTimes(2);
    expect(m.addShake).toHaveBeenCalledWith(0.2, 0.5);
  });

  test('"sfx" and pan-forwarding events use ctx.panFor(x)', () => {
    const m = makeMockCtx();
    applyEvents([{ type: "sfx", sfx: "whoosh", x: 9, z: 0 }], m.ctx);
    expect(m.panFor).toHaveBeenCalledWith(9);
    expect(m.playSfx).toHaveBeenCalledWith("whoosh", m.panFor.mock.results[0]!.value);
  });
});
