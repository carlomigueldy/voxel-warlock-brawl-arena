// The React shell root (?shell=react only). RENDERER/UI_MODE are both
// hardcoded to "legacy" in P3a (design §4) — R3F (P4) and the React UI (P5)
// don't exist yet, so this always resolves to LegacyRendererBridge +
// LegacyUiBridge. The flags are read here (not inlined) so P4/P5 only need
// to add their own branch, not touch this file's structure.
import { lazy, Suspense, useEffect, useRef } from "react";
import { RENDERER, UI_MODE } from "./config/flags";
import { getAudio, getUI } from "./services/registry";
import { useSessionStore } from "./store/useSessionStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { useUiStore } from "./store/useUiStore";
import { useGameSession } from "./loop/useGameSession";
import { LegacyRendererBridge } from "./legacy/LegacyRendererBridge";
import { LegacyUiBridge } from "./legacy/LegacyUiBridge";
import { isEnabled } from "./supabase.js";
import { initAuth, getUser, onAuthChange } from "./auth.js";
import { getRegion } from "./region.js";
import { preloadAssets } from "./loader.js";

// Lazy + dynamic import (not a static one) so `@react-three/fiber`/drei/the
// whole src/three/** tree is its own code-split chunk that the default
// `?renderer=legacy` path never fetches (design §2/CLAUDE.md quality gate:
// "r3f chunk code-split, NOT pulled into the legacy/default path"). RENDERER
// is read once at module load (config/flags.ts) and never flips within a
// session, so this only ever imports when the r3f branch actually renders.
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

      const ui = getUI();
      const onlineEnabled = isEnabled();
      ui.setOnlineEnabled(onlineEnabled);
      useUiStore.getState().setOnlineEnabled(onlineEnabled);

      const [user, region] = await Promise.allSettled([initAuth(), getRegion()]).then((results) =>
        results.map((r) => (r.status === "fulfilled" ? r.value : null)),
      );
      if (cancelled) return;

      if (region) {
        ui.setRegion(region as string);
        useSettingsStore.getState().setRegion(region as string);
      }

      if (onlineEnabled) {
        const activeUser = (user as ReturnType<typeof getUser>) || getUser();
        ui.renderAuthState(activeUser);
        useUiStore.getState().setAuthView(activeUser);
        onAuthChange((updatedUser) => {
          ui.renderAuthState(updatedUser);
          useUiStore.getState().setAuthView(updatedUser);
        });
      }

      ui.showMenu();
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
      <GameSession />
      {RENDERER === "r3f" ? (
        <Suspense fallback={null}>
          <GameCanvas />
        </Suspense>
      ) : (
        <LegacyRendererBridge />
      )}
      {UI_MODE === "react" ? null /* P5: <UiRoot/> */ : <LegacyUiBridge />}
    </>
  );
}
