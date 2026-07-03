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
// Global CSS imports live here (not main.tsx) — tokens.css/global.css/fx.css
// ship once UiRoot mounts. P6 deletes style.css and the legacy DOM these
// used to be a mere superset of (see former styles/PARTITION.md).
import "../styles/tokens.css";
import "../styles/global.css";
import "../styles/fx.css";
import { CAPTURE } from "../three/parity/determinism";
import { useSessionStore } from "../store/useSessionStore";
import { MenuRoot } from "./menu/MenuRoot";
import { LobbyRoot } from "./lobby/LobbyRoot";
import { Hud } from "./hud/Hud";
import { DraftOverlay } from "./draft/DraftOverlay";
import { TouchControls } from "./touch/TouchControls";
import { PauseMenu } from "./pause/PauseMenu";
import { ChatPanel } from "./chat/ChatPanel";
import { Onboarding } from "./onboarding/Onboarding";
import { Juice } from "./juice/Juice";
import styles from "./UiRoot.module.css";

export function UiRoot() {
  const screen = useSessionStore((s) => s.screen);

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
      {/* game overlays (render during the game screen, gate internally) */}
      {screen === "game" && <DraftOverlay />}
      {screen === "game" && <TouchControls />}
      {/* always-mounted overlays (gate internally on their own store flags) */}
      <Onboarding />
      <Juice />
      <PauseMenu />
      <ChatPanel />
      {/* P5 UiRoot render contract complete (design §9) — all 8 sibling
          regions mounted: menu/lobby/hud screens + draft/touch game overlays
          + onboarding/juice/pause/chat always-mounted overlays. */}
    </div>
  );
}
