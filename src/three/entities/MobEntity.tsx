// One big-mob instance — interpolation, entrance cinematic, HP bar feed,
// channel-decal lifecycle, and entityRegistry.triggerAttack registration
// (design §0/§3). Motion reads snapshotRef every frame (never subscribes to
// a store); only mount/unmount is driven by MobsLayer's roster membership.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CFG } from "../../config";
import { snapshotRef } from "../../store/snapshotRef";
import type { MobChannelSnap } from "../../types";
import { registerMob, unregisterMob, type Vec2 } from "./entityRegistry";
import { MobBody, type MobAnimInfo } from "../models/MobBody";
import { ChannelDecal } from "./ChannelDecal";

interface MobMotionState {
  rx: number;
  rz: number;
  ry: number;
  ra: number;
  spd: number;
  seeded: boolean;
}

export interface MobEntityProps {
  id: string;
}

export function MobEntity({ id }: MobEntityProps) {
  // Seed type/color from whichever snapshot made this mob appear in the
  // roster — both are fixed for the mob's lifetime (mirrors legacy building
  // the mesh once at first sight, design §3 "seed from first snap").
  const initial = useMemo(() => snapshotRef.current?.mobs.find((m) => m.id === id) ?? null, [id]);
  const type = initial?.type ?? "minion";
  const color = initial?.color ?? 0xaaaaaa;

  const groupRef = useRef<THREE.Group>(null);
  const bodyGroupRef = useRef<THREE.Group | null>(null);
  const motion = useRef<MobMotionState>({
    rx: initial?.x ?? 0,
    rz: initial?.z ?? 0,
    ry: initial?.y ?? 0,
    ra: initial?.a ?? 0,
    spd: 0,
    seeded: !!initial,
  });
  const animInfo = useRef<MobAnimInfo>({ speed: 0, maxSpeed: 5.0, falling: false, entrance: false, hpFrac: 1 });
  const posBus = useRef<Vec2>({ x: motion.current.rx, z: motion.current.rz });
  const chRef = useRef<MobChannelSnap | null>(null);
  const channelActiveRef = useRef(false);
  const [channelActive, setChannelActive] = useState(false);

  useEffect(() => {
    registerMob(id, {
      type,
      pos: posBus.current,
      triggerAttack: () => {
        const mobModel = bodyGroupRef.current?.userData.mobModel as { triggerAttack?: () => void } | undefined;
        mobModel?.triggerAttack?.();
      },
    });
    return () => unregisterMob(id);
  }, [id, type]);

  useFrame((_, rawDt) => {
    const t = snapshotRef.current?.mobs.find((m) => m.id === id);
    if (!t) return;

    const dt = Math.min(0.05, rawDt);
    const s = motion.current;
    if (!s.seeded) {
      s.rx = t.x;
      s.rz = t.z;
      s.ry = t.y ?? 0;
      s.ra = t.a ?? 0;
      s.spd = 0;
      s.seeded = true;
    }

    const prevX = s.rx;
    const prevZ = s.rz;
    // Entity interp lerp=1-exp(-18*dt) on x/z/y (design §0).
    const lerp = 1 - Math.exp(-18 * dt);
    s.rx += (t.x - s.rx) * lerp;
    s.rz += (t.z - s.rz) * lerp;
    s.ry += ((t.y ?? 0) - s.ry) * lerp;
    // Angle: shortest-arc lerp.
    let da = (t.a ?? 0) - s.ra;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    s.ra += da * lerp;

    const grp = groupRef.current;
    if (grp) {
      grp.position.set(s.rx, s.ry, s.rz);
      grp.rotation.y = -s.ra + Math.PI / 2;
    }

    // Mob speed smoothing: 1-exp(-8*dt) (design §0, distinct from players'
    // 1-exp(-10*dt)); inst=hypot(dx,dz)/dt.
    const inst = Math.hypot(s.rx - prevX, s.rz - prevZ) / dt;
    s.spd = s.spd + (inst - s.spd) * (1 - Math.exp(-8 * dt));

    // Entrance animation (design §0): progress=min(1,max(0,1-ent/2.5));
    // y=ry-(1-progress)*3; scale=max(0.05,progress)*baseScale — baseScale is
    // MobBody's own group's natural scale (procedural builders set their own
    // non-1 g.scale; GLB instances stay 1), so applying ONLY the
    // max(0.05,progress) factor on this OUTER group composes multiplicatively
    // with that inner scale to reproduce the exact same net scale legacy
    // computes by overwriting a single group's scale directly.
    const ent = t.ent ?? 0;
    const info = animInfo.current;
    if (ent > 0) {
      const progress = Math.min(1, Math.max(0, 1 - ent / (CFG.MOB_ENTRANCE ?? 2.5)));
      if (grp) {
        grp.position.y = s.ry - (1 - progress) * 3.0;
        grp.scale.setScalar(Math.max(0.05, progress));
      }
      // No animateMob/mobModel update — mob is locked in its spawn pose
      // during the cinematic (procedural rig or GLB mixer alike).
      info.entrance = true;
    } else {
      // Restore full scale (needed in the first frame after entrance ends).
      if (grp) grp.scale.setScalar(1);
      info.entrance = false;
      info.speed = s.spd;
      info.maxSpeed = 5.0;
      info.falling = !!t.f;
    }
    info.hpFrac = t.max > 0 ? Math.max(0.001, t.hp / t.max) : 0.001;

    // Interpolated position bus for entityRegistry consumers (CameraRig,
    // LightPool, EffectsLayer's nearestMob/triggerMobAttackNear).
    posBus.current.x = s.rx;
    posBus.current.z = s.rz;

    // Packet-loss-resilient channel telegraph (design §0/§3): mount/unmount
    // ChannelDecal only on a truthy<->falsy transition of `t.ch` (React
    // state), while chRef always holds the latest snapshot for the mounted
    // decal's own per-frame tick to read.
    const chNow = t.ch;
    if (chNow) {
      chRef.current = chNow;
      if (!channelActiveRef.current) {
        channelActiveRef.current = true;
        setChannelActive(true);
      }
    } else if (channelActiveRef.current) {
      channelActiveRef.current = false;
      setChannelActive(false);
    }
  });

  return (
    <group ref={groupRef}>
      <MobBody type={type} color={color} animRef={animInfo} bodyGroupRef={bodyGroupRef} />
      {channelActive && <ChannelDecal chRef={chRef} />}
    </group>
  );
}
