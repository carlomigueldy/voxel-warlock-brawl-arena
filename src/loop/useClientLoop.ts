// The client input-send loop — verbatim port of main.js's clientLoop
// (494-531) MINUS the render/HUD calls (LegacyRendererBridge's own rAF +
// onNewSnapshot handle those now) and minus snapshot receipt (that's
// Client's onState callback, wired in useGameSession, which applies the
// staleness gate and calls onNewSnapshot itself — design §6.4). This hook
// only sends input at CFG.INPUT_RATE.
import { useEffect } from "react";
import { CFG } from "../config.js";
import type { Client } from "../net.js";
import type { InputController } from "../input.js";
import { useSessionStore } from "../store/useSessionStore";

export function useClientLoop(client: Client | null, input: InputController | null): void {
  useEffect(() => {
    if (!client || !input) return;

    const mySession = useSessionStore.getState().sessionGen;
    const inputMs = 1000 / CFG.INPUT_RATE;
    let lastInput = 0;
    let raf = 0;

    function clientLoop(now: number): void {
      if (useSessionStore.getState().sessionGen !== mySession) return;
      if (now - lastInput >= inputMs) {
        client!.sendInput(input!.sample());
        lastInput = now;
      }
      if (useSessionStore.getState().sessionGen === mySession) raf = requestAnimationFrame(clientLoop);
    }
    raf = requestAnimationFrame(clientLoop);

    return () => cancelAnimationFrame(raf);
  }, [client, input]);
}
