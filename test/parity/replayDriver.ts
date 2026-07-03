// Browser-side capture driver (design §7 / issue #138) — dynamically
// imported by main.tsx ONLY under ?capture=1 (main.tsx's own module graph
// stays capture-free otherwise). Computes a fixture's snapshot stream with
// the SAME runReplay() the sim-replay determinism suite already trusts
// (test/replay/run-replay.mjs, test/replay/replay.determinism.test.mjs),
// then feeds it into the live page's snapshotRef ONE TICK AT A TIME —
// pushSnapshot() + exactly one render step per tick. P6 deletes the legacy
// renderer this used to also drive (via captureStep.ts) — the R3F path is
// now the only consumer, driven directly by `advance()`. No net/sim runs
// during capture (App.tsx skips <GameSession/> under CAPTURE) — this
// harness IS the sim, replayed from a recorded fixture instead of live
// input.
//
// Exposes `window.__parity`, the page-level API scripts/parity.mjs drives
// via Playwright's page.evaluate() — now an r3f-vs-r3f determinism check
// (scripts/parity.mjs's own header) rather than the r3f-vs-legacy parity
// gate it started as.
import { advance, flushSync } from "@react-three/fiber";
import { runReplay } from "../replay/run-replay.mjs";
import { CAPTURE_FIXED_DT } from "../../src/three/parity/determinism";
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
  fixtureId: string | null;
  frameCount: number;
  /** Loads + replays a fixture (test/replay/run-replay.mjs), resets
   * snapshotRef, and rewinds the capture cursor to -1 (nothing pushed yet).
   * Returns the fixture's tick count. */
  loadFixture(id: string): Promise<number>;
  /** Pushes every not-yet-applied tick up to (and including) `frame`, one
   * render step per tick, in order — never skips ticks, so Math.random()
   * draws inside build/VFX code stay in lockstep with a real run. */
  stepTo(frame: number): Promise<void>;
}

let stream: Snapshot[] = [];
let cursor = -1; // last applied tick index; -1 = nothing pushed yet
let r3fClockT = 0; // seconds; advances by CAPTURE_FIXED_DT per r3f step

// One R3F frame step — driven by the module-level `advance()` export
// directly, no per-instance registration needed, it operates on whichever
// root is currently mounted (there is exactly one, GameCanvas's <Canvas>).
function renderOneFrame(): void {
  r3fClockT += CAPTURE_FIXED_DT;
  advance(r3fClockT);
}

export function installParityHarness(): void {
  const api: ParityApi = {
    ready: false,
    fixtureId: null,
    frameCount: 0,
    async loadFixture(id: string) {
      const loader = resolveFixtureLoader(id);
      const mod = await loader();
      const fixture = mod.default as Parameters<typeof runReplay>[0];
      stream = runReplay(fixture) as Snapshot[];
      resetSnapshotRef();
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
        // Real gameplay syncs useRosterStore from onNewSnapshot.ts on every
        // tick (design §3: every entity Layer — Players/Mobs/Bolts/Meteors/
        // Items — keys off its id array, spawn/despawn only); the capture
        // path intentionally skips onNewSnapshot's OTHER fan-out (audio/HUD/
        // session-phase side effects have no bearing on a screenshot and
        // could introduce non-determinism), but roster sync is itself
        // deterministic (no Math.random, no I/O) and is the one piece of
        // that fan-out every render-owning entity Layer requires to mount
        // at all — omitting it would silently render an empty scene no
        // matter which entity issue's Layer this replays.
        //
        // flushSync (THE @react-three/fiber EXPORT, not react-dom's — R3F's
        // <Canvas> tree is its own react-reconciler instance with its own
        // scheduler, so react-dom's flushSync has no effect on it) forces
        // the RENDER/COMMIT/layout-effect phases to run synchronously — the
        // new/removed entity and its useFrame subscription ARE observably
        // in place the instant flushSync returns (scene-graph child count
        // and state.internal.subscribers both update inline — verified).
        // But that is NOT sufficient: R3F's host-config finalization for a
        // freshly-mounted <primitive> (the bookkeeping that makes the new
        // subscriber actually reachable from the NEXT advance() call) is
        // additionally scheduled onto a macrotask — a same-tick microtask
        // (`await Promise.resolve()`) still observes a stale
        // subscriber/scene-graph read, only a real event-loop turn
        // (`setTimeout`) does not. Skipping this wait would make a spawned/
        // despawned entity's very first position write silently no-op:
        // advance() would render using a subscriber list that logically
        // "has" the new entry (per React) but whose R3F-side wiring hasn't
        // landed yet, so the entity would sit frozen at its pool-reset
        // origin (0,0,0) for however many ticks until the NEXT roster
        // change happened to trigger another wait — i.e. it could miss
        // every captured frame entirely. Only paid on ticks where the
        // roster actually changed (`before`/`after` reference check) — a
        // steady roster (the overwhelming majority of ticks) stays a
        // synchronous, zero-wait loop iteration.
        const before = useRosterStore.getState();
        useRosterStore.getState().sync(deriveRoster(stream[tick], snapshotRef.meta));
        if (useRosterStore.getState() !== before) {
          flushSync(() => {});
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        renderOneFrame();
      }
      cursor = frame;
    },
  };
  (window as unknown as { __parity: ParityApi }).__parity = api;
  api.ready = true;
}
