// The authoritative host loop — verbatim port of main.js's hostLoop
// (362-414), minus the render call (now LegacyRendererBridge's own separate
// rAF — design §5.2) and minus the direct ui.updateHUD/... calls (now
// onNewSnapshot's job). What's left is exactly design §7 invariant (5): sim
// input -> accumulator -> sim.step -> snapshot -> broadcast -> onNewSnapshot,
// and nothing else. Broadcast is NEVER inside a try/catch — a render/fan-out
// bug must not be able to silently swallow a sim/network fault.
//
// `host`/`sim`/`input` are nullable so this hook can ALWAYS be called (rules
// of hooks — see useGameSession, which calls this unconditionally and lets
// the effect below no-op while there is no active host session).
// localIdRef is a plain mutable ref (not React state): localId is assigned
// once, asynchronously, by Host's onReady callback, and must be read fresh
// every rAF tick without ever needing to restart this effect.
import { useEffect } from "react";
import { CFG, MSG } from "../config.js";
import { PHASE, type Simulation } from "../sim.js";
import type { Host } from "../net.js";
import type { InputController } from "../input.js";
import { useSessionStore } from "../store/useSessionStore";
import { makeAccumulator } from "./fixedTimestep";
import { onNewSnapshot } from "./onNewSnapshot";

export function useHostLoop(
  host: Host | null,
  sim: Simulation | null,
  input: InputController | null,
  localIdRef: { current: string | null },
): void {
  useEffect(() => {
    if (!host || !sim || !input) return;

    const mySession = useSessionStore.getState().sessionGen;
    const accum = makeAccumulator(CFG.TICK_RATE);
    let raf = 0;

    function hostLoop(now: number): void {
      if (useSessionStore.getState().sessionGen !== mySession) return;

      if (sim!.phase === PHASE.PLAYING || sim!.phase === PHASE.COUNTDOWN) {
        sim!.setInput(localIdRef.current!, input!.sample());
      }

      const { n, stepDt } = accum.steps(now);
      for (let i = 0; i < n; i++) sim!.step(stepDt);

      const snap = sim!.snapshot();
      host!.broadcast({ type: MSG.STATE, ...snap });
      onNewSnapshot(snap, localIdRef.current);

      if (useSessionStore.getState().sessionGen === mySession) raf = requestAnimationFrame(hostLoop);
    }
    raf = requestAnimationFrame(hostLoop);

    return () => cancelAnimationFrame(raf);
  }, [host, sim, input, localIdRef]);
}
