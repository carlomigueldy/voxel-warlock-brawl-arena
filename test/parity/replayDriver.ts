// Browser-side capture driver (design §7 / issue #138) — dynamically
// imported by main.tsx ONLY under ?capture=1 (main.tsx's own module graph
// stays capture-free otherwise). Computes a fixture's snapshot stream with
// the SAME runReplay() the sim-replay determinism suite already trusts
// (test/replay/run-replay.mjs, test/replay/replay.determinism.test.mjs),
// then feeds it into the live page's snapshotRef ONE TICK AT A TIME —
// pushSnapshot() + exactly one render step per tick — so both renderers
// consume the identical sequence regardless of which one is mounted
// (App.tsx's RENDERER-exclusive branch, unchanged by this file). No net/sim
// runs during capture (App.tsx skips <GameSession/> under CAPTURE) — this
// harness IS the sim, replayed from a recorded fixture instead of live
// input.
//
// Exposes `window.__parity`, the page-level API scripts/parity.mjs drives
// via Playwright's page.evaluate().
import { advance, flushSync } from "@react-three/fiber";
import { runReplay } from "../replay/run-replay.mjs";
import { RENDERER } from "../../src/config/flags";
import { CAPTURE_FIXED_DT } from "../../src/three/parity/determinism";
import { runCaptureStep } from "../../src/three/parity/captureStep";
import { pushSnapshot, setLocalId, resetSnapshotRef, snapshotRef } from "../../src/store/snapshotRef";
import { useRosterStore, deriveRoster } from "../../src/store/useRosterStore";
import type { Snapshot } from "../../src/types";

// eager:false (default) keeps every fixture its own async chunk — loadFixture
// only ever awaits the ONE the page was asked to capture.
const fixtureLoaders = import.meta.glob("../replay/fixtures/*.json") as Record<
  string,
  () => Promise<{ default: unknown }>
>;

function resolveFixtureLoader(id: string): () => Promise<{ default: unknown }> {
  const key = `../replay/fixtures/${id}.json`;
  const loader = fixtureLoaders[key];
  if (!loader) {
    const known = Object.keys(fixtureLoaders).map((k) =>
      k.replace("../replay/fixtures/", "").replace(".json", ""),
    );
    throw new Error(`[parity] unknown fixture "${id}" — known fixtures: ${known.join(", ")}`);
  }
  return loader;
}

export interface ParityApi {
  ready: boolean;
  renderer: "legacy" | "r3f";
  fixtureId: string | null;
  frameCount: number;
  /** Loads + replays a fixture (test/replay/run-replay.mjs), resets
   * snapshotRef, and rewinds the capture cursor to -1 (nothing pushed yet).
   * Returns the fixture's tick count. */
  loadFixture(id: string): Promise<number>;
  /** Pushes every not-yet-applied tick up to (and including) `frame`, one
   * render step per tick, in order — never skips ticks, so Math.random()
   * draws inside build/VFX code stay in lockstep with a real run. Returns a
   * Promise (Playwright's page.evaluate awaits it automatically) — see the
   * "settle" comment inside for why R3F needs one extra async beat here. */
  stepTo(frame: number): void | Promise<void>;
}

let stream: Snapshot[] = [];
let cursor = -1; // last applied tick index; -1 = nothing pushed yet
let r3fClockT = 0; // seconds; advances by CAPTURE_FIXED_DT per r3f step

// Renderer-specific one-frame step. LEGACY runs the exact per-frame body
// LegacyRendererBridge's own rAF would have run (captureStep.ts); R3F is
// driven by the module-level `advance()` export directly — no per-instance
// registration needed, it operates on whichever root(s) are currently
// mounted (there is exactly one under App.tsx's RENDERER-exclusive branch).
function renderOneFrame(): void {
  if (RENDERER === "r3f") {
    r3fClockT += CAPTURE_FIXED_DT;
    advance(r3fClockT);
  } else {
    runCaptureStep("legacy");
  }
}

export function installParityHarness(): void {
  const api: ParityApi = {
    ready: false,
    renderer: RENDERER,
    fixtureId: null,
    frameCount: 0,
    async loadFixture(id: string) {
      const loader = resolveFixtureLoader(id);
      const mod = await loader();
      const fixture = mod.default as Parameters<typeof runReplay>[0];
      stream = runReplay(fixture) as Snapshot[];
      resetSnapshotRef();
      // Mirrors onNewSnapshot's teardown/resync pair (design §3 Pooling
      // note: "Teardown→releaseBolt(flush)+resetSnapshotRef()+
      // useRosterStore.reset()") — a fresh fixture load must start every
      // R3F *Layer (design §3: PlayersLayer/MobsLayer/BoltsLayer/...) from
      // an empty roster, same as resetSnapshotRef() does for snapshotRef.
      useRosterStore.getState().reset();
      setLocalId(fixture.players[0]?.id ?? null);
      cursor = -1;
      r3fClockT = 0;
      api.fixtureId = id;
      api.frameCount = stream.length;
      return api.frameCount;
    },
    async stepTo(frame: number) {
      for (let tick = cursor + 1; tick <= frame; tick++) {
        pushSnapshot(stream[tick]);
        // R3F's *Layer components (design §3) mount/unmount entities off
        // useRosterStore's id arrays, NEVER off snapshotRef directly — the
        // real game loop keeps that store in sync via onNewSnapshot()
        // (src/loop/onNewSnapshot.ts), which this capture-only replay path
        // deliberately bypasses (no audio/HUD/session side effects during a
        // headless capture). Roster sync alone is NOT a side effect (it's
        // pure structural bookkeeping the render tree depends on to exist
        // at all — without it every *Layer stays permanently empty under
        // ?capture=1&renderer=r3f), so it's pulled out and called here on
        // its own, same as onNewSnapshot's own first two lines.
        useRosterStore.getState().sync(deriveRoster(stream[tick], snapshotRef.meta));
        renderOneFrame();
      }
      cursor = frame;
      // Settle pass (R3F only): useRosterStore.sync() above schedules a
      // React commit through R3F's OWN custom reconciler — <Canvas> mounts
      // an entirely separate React root (react-reconciler, not react-dom),
      // so even react-dom's flushSync cannot force that commit synchronous.
      // A newly-spawned entity (e.g. a player joining) therefore mounts
      // asynchronously, sometime AFTER this loop already returned; under
      // frameloop="never" nothing else ever calls advance() again, so that
      // entity would otherwise register (entityRegistry, mixer, etc.) but
      // never draw a single pixel. Wait one rAF round-trip — long enough
      // for React's scheduler to flush the pending commit; the exact
      // technique scripts/parity.mjs's own capture loop already uses before
      // every screenshot — then re-advance the R3F root at the SAME
      // timestamp (dt≈0: this does not advance sim/animation time, it only
      // lets freshly-mounted useFrame subscribers draw the frame that
      // already exists).
      if (RENDERER === "r3f") {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        advance(r3fClockT);
      }
    },
  };
  (window as unknown as { __parity: ParityApi }).__parity = api;
  api.ready = true;
}
