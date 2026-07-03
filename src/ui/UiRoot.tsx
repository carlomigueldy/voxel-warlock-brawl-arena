// The P5 React UI root — mounted at App.tsx:150 behind `?ui=react` (design
// §1/§Scope). p5a stood up the seam, the CSS token/fx system, and the
// shared primitive kit; this is the design §9 UiRoot render contract each
// sibling PR (#161-#168) adds its own `screen==="..."` / overlay-flag branch
// to — a pass-through host div, not a styled shell. Most regions (MenuRoot,
// Hud) manage their own full-viewport positioning; LobbyRoot is the
// exception — its `.scene` is `min-height:100%` and relies on the
// `.screenLayer` full-viewport parent below (a follow-up will make it
// self-position for symmetry — see the shared-shell consolidation note).
//
// Global CSS imports live here (not main.tsx) so `?ui=legacy` never even
// evaluates this module — tokens.css/global.css/fx.css only ship once
// UiRoot is actually reachable. (style.css itself is still linked
// unconditionally from index.html until P6, so these are a superset today,
// not yet load-bearing — see styles/PARTITION.md.)
import "../styles/tokens.css";
import "../styles/global.css";
import "../styles/fx.css";
import { useEffect } from "react";
import { CAPTURE } from "../three/parity/determinism";
import { useSessionStore } from "../store/useSessionStore";
import { MenuRoot } from "./menu/MenuRoot";
import { LobbyRoot } from "./lobby/LobbyRoot";
import { Hud } from "./hud/Hud";
import { PauseMenu } from "./pause/PauseMenu";
import { ChatPanel } from "./chat/ChatPanel";
import { Onboarding } from "./onboarding/Onboarding";
import { Juice } from "./juice/Juice";
import styles from "./UiRoot.module.css";

// index.html's static legacy `#menu` markup ships `class="overlay
// menu-cinematic"` (visible by default; `#lobby`/`#hud` already default to
// `class="... hidden"`). Under `?ui=legacy` ui.js's own showMenu() owns
// toggling it. Under `?ui=react`, `<LegacyUiBridge>` (and so `new UI()`)
// never MOUNTS, but `getUI()` is still a page-lifetime singleton other
// frozen code paths reach into regardless of UI_MODE — notably App.tsx's
// own `useAppBootstrap()` unconditionally calls `ui.showMenu()` right
// before `useSessionStore.setScreen("menu")` (design §3 point 2's "harmless
// no-op" dual-write — harmless for state, but showMenu() also strips the
// `hidden` class from this very-visible static DOM). Without re-asserting
// `hidden` here, the legacy menu bleeds through under the React one on
// every transition back to the menu (boot-check glitch: doubled title/
// copy). Keying the effect on `screen` re-hides it right after each such
// call, in the same commit `screen` flips to "menu" — a targeted DOM
// fixup responding to known frozen call sites, not a MutationObserver.
// (Follow-up: a subscription-based useHideLegacyOverlay covering
// #menu/#lobby/#hud closes the quick-match-failure edge #171 review flagged.)
function useHideLegacyMenuDom(screen: string): void {
  useEffect(() => {
    if (screen === "menu") document.getElementById("menu")?.classList.add("hidden");
  }, [screen]);
}

export function UiRoot() {
  const screen = useSessionStore((s) => s.screen);
  useHideLegacyMenuDom(screen);

  // Mirrors App.tsx's own `!CAPTURE` guard (design §1) — belt-and-suspenders
  // so UiRoot is inert under `?capture=1` even if ever rendered outside that
  // outer conditional (e.g. a future refactor, or a unit test mounting it
  // directly).
  if (CAPTURE) return null;

  return (
    <div data-testid="ui-root">
      {screen === "menu" && <MenuRoot />}
      {screen === "lobby" && (
        <div className={styles.screenLayer}>
          <LobbyRoot />
        </div>
      )}
      {screen === "game" && <Hud />}
      {/* always-mounted overlays (gate internally on their own store flags) */}
      <Onboarding />
      <Juice />
      <PauseMenu />
      <ChatPanel />
      {/* remaining Wave-2 regions: game overlays (#164 draft / #167 touch)
          — each sibling adds its own line here per design §9's UiRoot
          render contract. */}
    </div>
  );
}
