// The React shell root — P6 collapses this to the single React/R3F path
// (the legacy prototype and its RENDERER/UI_MODE flags are deleted; this
// file used to branch on both, now it unconditionally mounts GameCanvas +
// UiRoot).
import { lazy, Suspense, useEffect, useRef } from "react";
import { CAPTURE } from "./three/parity/determinism";
import { getAudio } from "./services/registry";
import { useSessionStore } from "./store/useSessionStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { useUiStore } from "./store/useUiStore";
import { useGameSession } from "./loop/useGameSession";
import { UiRoot } from "./ui/UiRoot";
import { isEnabled } from "./supabase.js";
import { initAuth, getUser, onAuthChange } from "./auth.js";
import { getRegion } from "./region.js";
import { preloadAssets } from "./loader.js";

// Lazy + dynamic import (not a static one) so `@react-three/fiber`/drei/the
// whole src/three/** tree stays its own code-split chunk, fetched in
// parallel with (not blocking) the initial bundle's parse/eval — this app
// mounts <GameCanvas/> unconditionally now (single React/R3F path, P6), but
// the chunk split itself is still worth keeping for initial-paint latency.
const GameCanvas = lazy(() => import("./three/GameCanvas").then((m) => ({ default: m.GameCanvas })));

// Port of main.js's loading-gate IIFE (934-1005): preload assets (12s safety
// race), wait for the loader-enter reveal + a real user gesture (browsers
// require one to unlock AudioContext), fade the loader, then boot online
// services. Drives the SAME static #loader DOM both entry paths share.
// Ref-guarded so a stray remount of <App/> can't double-run it (React 19 has
// no StrictMode here — see main.tsx — but this guard is cheap insurance).
function useAppBootstrap(): void {
  const ranRef = useRef(false);
  useEffect(() => {
    // ?capture=1: the parity harness drives the renderer directly via
    // window.__parity (test/parity/replayDriver.ts, wired from main.tsx) —
    // skip the loader→user-gesture→auth/region→menu flow entirely so a
    // capture page load never blocks on a network call or a synthetic
    // Playwright click (design §7 / issue #138).
    if (CAPTURE) return;
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;
    (async () => {
      const loaderEl = document.getElementById("loader");
      const barEl = document.getElementById("loader-bar");
      const pctEl = document.getElementById("loader-pct");
      const enterEl = document.getElementById("loader-enter");

      const safetyTimeout = new Promise<void>((r) => setTimeout(r, 12000));
      try {
        await Promise.race([
          preloadAssets({
            onProgress(p: number) {
              const v = Math.min(100, Math.round(p * 100));
              if (barEl) {
                barEl.style.width = v + "%";
                barEl.parentElement?.setAttribute("aria-valuenow", String(v));
              }
              if (pctEl) pctEl.textContent = v + "%";
            },
          }),
          safetyTimeout,
        ]);
      } catch { /* individual asset errors are handled inside preloadAssets */ }
      if (cancelled) return;

      if (barEl) barEl.style.width = "100%";
      if (pctEl) pctEl.textContent = "100%";
      if (enterEl) enterEl.classList.remove("hidden");

      await new Promise<void>((resolve) => {
        addEventListener("pointerdown", () => resolve(), { once: true });
        addEventListener("keydown", () => resolve(), { once: true });
      });
      if (cancelled) return;

      const audio = getAudio();
      audio.resume();
      audio.startMusic();

      if (loaderEl) {
        loaderEl.classList.add("loader-fade-out");
        setTimeout(() => loaderEl.classList.add("hidden"), 560);
      }

      const onlineEnabled = isEnabled();
      useUiStore.getState().setOnlineEnabled(onlineEnabled);

      const [user, region] = await Promise.allSettled([initAuth(), getRegion()]).then((results) =>
        results.map((r) => (r.status === "fulfilled" ? r.value : null)),
      );
      if (cancelled) return;

      if (region) {
        useSettingsStore.getState().setRegion(region as string);
      }

      if (onlineEnabled) {
        const activeUser = (user as ReturnType<typeof getUser>) || getUser();
        useUiStore.getState().setAuthView(activeUser);
        onAuthChange((updatedUser) => {
          useUiStore.getState().setAuthView(updatedUser);
        });
      }

      useSessionStore.getState().setScreen("menu");
    })();

    return () => { cancelled = true; };
  }, []);
}

// Mounts the authoritative game loop (useHostLoop XOR useClientLoop, via
// useGameSession) as a SIBLING of the renderer, never inside it — a render
// throw inside <Canvas>/LegacyRendererBridge must never be able to prevent
// the next sim.step()/host.broadcast() (design §0 / §7 invariant 5).
function GameSession(): null {
  useGameSession();
  return null;
}

export default function App() {
  useAppBootstrap();
  return (
    <>
      {/* ?capture=1: no net/sim during capture — the parity harness pushes
          fixture snapshots straight into snapshotRef (design §7), so the
          host/client loop this mounts must not also run. */}
      {!CAPTURE && <GameSession />}
      <Suspense fallback={null}>
        <GameCanvas />
      </Suspense>
      {/* ?capture=1: the HUD/menu/onboarding DOM is force-hidden anyway
          (determinism.ts's hideChrome) and has nothing to wire — skip it. */}
      {!CAPTURE && <UiRoot />}
    </>
  );
}
