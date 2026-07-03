// Persistent ground-ring telegraph for a mob's active channel (design §0/§3
// "persistent channel decal"; ports renderer.js's `_buildChannelDecal` /
// `ring.userData.updateChannel`). Packet-loss-resilient by construction: it
// mirrors the mob's `ch` snapshot field every frame rather than reacting only
// to the one-shot `mobTelegraph` event, so a late-joining/reconnecting client
// still sees the warning ring for the remainder of the cast window.
//
// Bridged through <PrimitiveFx> (build-once, tick-imperatively — design §4):
// MobEntity mounts this component only while `ch` is truthy and keeps a
// mutable ref to the latest `ch` snapshot for `tick` to read every frame —
// the same "owner writes, reader reads a shared mutable object" pattern
// entityRegistry's `pos` bus uses.
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { PrimitiveFx } from "../Bridge";
import type { MobChannelSnap } from "../../types";

const CHANNEL_COLOR = 0xff8800;

// PrimitiveFx's `build` must return a THREE.Group (Bridge.tsx), so the ring
// mesh itself lives one level down; `updateChannel` closes over it directly.
function buildChannelDecal(ch: MobChannelSnap): THREE.Group {
  const group = new THREE.Group();
  let radius = ch.r || 4;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.25, radius + 0.25, 48),
    new THREE.MeshBasicMaterial({ color: CHANNEL_COLOR, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(ch.x, 0.12, ch.z);
  group.add(ring);

  // Called every frame with the latest `ch` snapshot to sync position,
  // radius, and opacity. Pulsing is driven by remaining cast time (ch.t),
  // flashing faster as the cast window closes — verbatim from renderer.js.
  group.userData.updateChannel = (newCh: MobChannelSnap) => {
    const nr = newCh.r || 4;
    // Rebuild geometry only if radius changed (rare — but safe to do).
    if (Math.abs(nr - radius) > 0.01) {
      ring.geometry.dispose();
      ring.geometry = new THREE.RingGeometry(nr - 0.25, nr + 0.25, 48);
      radius = nr;
    }
    ring.position.set(newCh.x, 0.12, newCh.z);
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.4 * Math.abs(Math.sin(newCh.t * 6));
  };

  return group;
}

export interface ChannelDecalProps {
  /** Mutable, MobEntity-owned latest `ch` snapshot — non-null for the whole
   * mounted lifetime of this component (MobEntity only renders it while
   * truthy). */
  chRef: MutableRefObject<MobChannelSnap | null>;
}

export function ChannelDecal({ chRef }: ChannelDecalProps) {
  return (
    <PrimitiveFx
      build={() => buildChannelDecal(chRef.current as MobChannelSnap)}
      tick={(group) => {
        if (!chRef.current) return;
        (group.userData.updateChannel as ((ch: MobChannelSnap) => void) | undefined)?.(chRef.current);
      }}
    />
  );
}
