// The P5 React UI root — mounted at App.tsx:150 behind `?ui=react` (design
// §1/§Scope). This PR (p5a) is infrastructure only: a minimal placeholder
// shell that proves the seam, the CSS token/fx system, and the shared
// primitive kit all wire up correctly. The real menu/lobby/HUD/draft/pause
// surfaces are the sibling PRs (#161-#168) — they replace this component's
// body, not its mount point or the imports below.
//
// Global CSS imports live here (not main.tsx) so `?ui=legacy` never even
// evaluates this module — tokens.css/global.css/fx.css only ship once
// UiRoot is actually reachable. (style.css itself is still linked
// unconditionally from index.html until P6, so these are a superset today,
// not yet load-bearing — see styles/PARTITION.md.)
import "../styles/tokens.css";
import "../styles/global.css";
import "../styles/fx.css";
import { CAPTURE } from "../three/parity/determinism";
import { useSessionStore } from "../store/useSessionStore";
import { Panel } from "./common";
import { LobbyRoot } from "./lobby/LobbyRoot";
import styles from "./UiRoot.module.css";

// screen-gated mount point (design §9's UiRoot render contract) — added by
// p5-lobby-qr (#162), the first sibling to replace part of p5a's
// placeholder body. Each screen/overlay sibling (#161 menu, #163 HUD, ...)
// adds its own `{screen === "x" && <XRoot/>}` line alongside the ones below
// rather than re-deriving this `screen` subscription; the placeholder Panel
// narrows to "not yet covered" screens so ?ui=react never goes blank.
export function UiRoot() {
  // Hook first, early return after (Rules of Hooks) — CAPTURE is a
  // module-load-time constant so this branch is invariant for a given
  // mounted instance either way, but keeping the call unconditional avoids
  // relying on that invariant.
  const screen = useSessionStore((s) => s.screen);

  // Mirrors App.tsx's own `!CAPTURE` guard (design §1) — belt-and-suspenders
  // so UiRoot is inert under `?capture=1` even if ever rendered outside that
  // outer conditional (e.g. a future refactor, or a unit test mounting it
  // directly).
  if (CAPTURE) return null;

  // p5a's `.shell` was sized for the placeholder only (a small out-of-the-way
  // corner badge — see UiRoot.module.css's header). A real, full-viewport
  // screen needs `.screenLayer` instead (position:fixed;inset:0, high enough
  // z-index to sit above the legacy .overlay elements) or it renders
  // squeezed into that corner box. Swap wrappers based on whether a real
  // screen is mounted; extend the `screen === "x"` list below as more
  // siblings land instead of re-deriving this split.
  const hasScreen = screen === "lobby";

  return (
    <div className={hasScreen ? styles.screenLayer : styles.shell} data-testid="ui-root">
      {screen === "lobby" && <LobbyRoot />}
      {!hasScreen && (
        <Panel compact role="status" aria-live="polite">
          <p className={styles.badge}>React UI scaffold (?ui=react) — menus/HUD land in follow-up PRs</p>
        </Panel>
      )}
    </div>
  );
}
