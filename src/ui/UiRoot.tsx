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
import { Hud } from "./hud/Hud";
import styles from "./UiRoot.module.css";

export function UiRoot() {
  // Hook first, `!CAPTURE` early-return after (rules-of-hooks: CAPTURE is a
  // module-level constant so this is stable across a mount's lifetime, but
  // hooks still must run unconditionally on every render).
  const screen = useSessionStore((s) => s.screen);

  // Mirrors App.tsx's own `!CAPTURE` guard (design §1) — belt-and-suspenders
  // so UiRoot is inert under `?capture=1` even if ever rendered outside that
  // outer conditional (e.g. a future refactor, or a unit test mounting it
  // directly).
  if (CAPTURE) return null;

  // design §9 integration contract: each sibling adds exactly one mount line
  // at its assigned region. `screen==="game"` is #163 p5-hud's region; every
  // other screen still falls back to the p5a placeholder until its owning
  // sibling (#161 menu / #162 lobby) lands.
  return (
    <div className={styles.shell} data-testid="ui-root">
      {screen === "game" ? (
        <Hud />
      ) : (
        <Panel compact role="status" aria-live="polite">
          <p className={styles.badge}>React UI scaffold (?ui=react) — menus/HUD land in follow-up PRs</p>
        </Panel>
      )}
    </div>
  );
}
