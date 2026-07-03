// Smoke test for vfx/beams.ts (#144) — the .js->.ts port must stay
// value-identical: same transient effect contract (userData.update/done/
// dispose), the same pooled BEAM_LIGHT_POOL_SIZE=3 PointLight cap, Lambert/
// Basic-only materials (design §0 PALETTE CORRECTION), and the BEAM_VFX
// registry slice shape unchanged. Not a parity/screenshot test (that's
// scripts/parity.mjs) — just a fast guard that the port didn't change
// runtime behavior.
import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { CFG } from "../src/config.js";
import {
  buildLightningBeam,
  buildChainBeam,
  buildDrainBeam,
  buildPullBeam,
  buildDragBeam,
  buildLinkBeam,
  BEAM_VFX,
} from "../src/vfx/beams.js";

describe("vfx/beams.ts (#144)", () => {
  test("buildLightningBeam returns a transient effect group with the userData contract", () => {
    const g = buildLightningBeam(0, 0, 5, 5, 0x9fe6ff);
    expect(g).toBeInstanceOf(THREE.Group);
    expect(typeof g.userData.update).toBe("function");
    expect(typeof g.userData.dispose).toBe("function");
    expect(g.userData.done).toBe(false);
    // Advance well past life=0.3s — must flip done and not throw.
    g.userData.update(0.1);
    g.userData.update(0.5);
    expect(g.userData.done).toBe(true);
    expect(() => g.userData.dispose()).not.toThrow();
  });

  test("buildChainBeam is the same builder as buildLightningBeam (alias, not a copy)", () => {
    expect(buildChainBeam).toBe(buildLightningBeam);
  });

  test("only Lambert/Basic materials ever appear on beam meshes (never Standard)", () => {
    const g = buildDrainBeam(0, 0, 4, 0, 0xaa2f6b);
    const mats: THREE.Material[] = [];
    g.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material;
      if (!mat) return;
      mats.push(...(Array.isArray(mat) ? mat : [mat]));
    });
    expect(mats.length).toBeGreaterThan(0);
    for (const m of mats) {
      expect(m).not.toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshBasicMaterial).toBe(true);
    }
    g.userData.dispose();
  });

  test("beam glow lights are drawn from a shared pool capped at CFG.BEAM_LIGHT_POOL_SIZE", () => {
    expect(CFG.BEAM_LIGHT_POOL_SIZE).toBe(3);
    const beams = [
      buildPullBeam(0, 0, 1, 1, 0x8fffc4),
      buildDragBeam(0, 0, 1, 1, 0x4cff9c),
      buildLinkBeam(0, 0, 1, 1, 0x2fd9c4),
      buildLinkBeam(1, 1, 2, 2, 0x2fd9c4), // 4th beam — pool is exhausted, must degrade gracefully
    ];
    const lights = beams.filter((b) => b.userData.light);
    // At most BEAM_LIGHT_POOL_SIZE lights can be live across every active beam.
    expect(lights.length).toBeLessThanOrEqual(CFG.BEAM_LIGHT_POOL_SIZE);
    for (const b of beams) expect(() => b.userData.dispose()).not.toThrow();
  });

  test("BEAM_VFX registry has drain/pull/drag/link entries with cast/impact/buildCore", () => {
    for (const key of ["drain", "pull", "drag", "link"] as const) {
      const entry = BEAM_VFX[key];
      expect(entry).toBeDefined();
      expect(typeof entry.color).toBe("number");
      expect(typeof entry.buildCore).toBe("function");
      expect(typeof entry.cast).toBe("function");
      expect(typeof entry.impact).toBe("function");
      const core = entry.buildCore(entry.color);
      expect(core).toBeInstanceOf(THREE.Group);
      const cast = entry.cast({ x: 0, z: 0, x2: 3, z2: 3, color: entry.color });
      expect(cast).toBeInstanceOf(THREE.Group);
      (cast as THREE.Group).userData.dispose();
    }
  });
});
