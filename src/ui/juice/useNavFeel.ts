// React port of src/nav-feel.js (design §9a #168) — keyboard spine
// navigation + Escape-to-back for the menu. Legacy attaches a keydown
// delegate to `.menu-spine` and a MutationObserver watching `.spine-nav` for
// `is-active`/`aria-current` flips to keep a floating "Back" button in sync.
// React already has one source of truth for "which sub-screen is active"
// (`useMenuNavStore.screen`, design §3 point 3), so this port reads/writes
// that store directly instead of observing DOM mutations — the MutationObserver
// and its `syncState()` polling go away entirely; `backVisible` below is just
// a derived boolean.
//
// #161 p5-menu owns MenuRoot's actual spine buttons (their DOM lives in a
// CSS Module, hashed classnames), so this hook can't reach into them by a
// legacy `.spine-btn` selector. It instead scopes to MenuRoot's semantic
// landmark (`nav[aria-label="Main menu"]`, present in MenuRoot.tsx) to know
// whether keyboard focus is inside the spine, and to refocus the newly
// active button (found via `[aria-current="true"]`, which MenuRoot already
// sets) after moving.
import { useCallback, useEffect } from "react";
import { useMenuNavStore, type MenuScreen } from "../../store/useMenuNavStore";
import { useSessionStore } from "../../store/useSessionStore";
import { menuCue } from "../../audio";

const DEFAULT_SCREEN: MenuScreen = "online";
// Mirrors MenuRoot.tsx's SPINE_ITEMS order (design §9a: the six sub-screens
// ui.js's _showMenuScreen toggles).
const SPINE_ORDER: MenuScreen[] = ["online", "private", "characters", "leaderboards", "account", "tutorial"];
const SPINE_NAV_SELECTOR = 'nav[aria-label="Main menu"]';

// Any open Modal (design §4 shared primitive: draft/pause/credits dialogs)
// owns Escape itself — mirrors legacy's overlaysClosed() guard so nav-feel's
// back-navigation never double-fires alongside a dialog's own close.
function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

export interface NavFeelState {
  /** Whether the floating Back affordance should render — in the menu, off
   * the default ("online") sub-screen. */
  backVisible: boolean;
  goBack(): void;
}

export function useNavFeel(): NavFeelState {
  const appScreen = useSessionStore((s) => s.screen);
  const menuScreen = useMenuNavStore((s) => s.screen);
  const setMenuScreen = useMenuNavStore((s) => s.setScreen);

  const goBack = useCallback(() => {
    if (menuScreen === DEFAULT_SCREEN) return;
    menuCue("back");
    setMenuScreen(DEFAULT_SCREEN);
  }, [menuScreen, setMenuScreen]);

  useEffect(() => {
    if (appScreen !== "menu") return;

    function onKeydown(e: KeyboardEvent) {
      if (modalOpen()) return;

      if (e.key === "Escape") {
        if (menuScreen !== DEFAULT_SCREEN) {
          e.preventDefault();
          goBack();
        }
        return;
      }

      const nav = document.querySelector(SPINE_NAV_SELECTOR);
      if (!nav || !nav.contains(document.activeElement)) return;

      const n = SPINE_ORDER.length;
      const i = Math.max(0, SPINE_ORDER.indexOf(menuScreen));
      let next = -1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (i + 1) % n;
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (i - 1 + n) % n;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = n - 1;
      if (next < 0) return;

      e.preventDefault();
      menuCue("hover");
      setMenuScreen(SPINE_ORDER[next]);
      // The newly active button gets aria-current="true" once MenuRoot
      // re-renders; focus it on the next frame (mirrors legacy's synchronous
      // `dest.focus()`, just deferred a tick since React owns the DOM here).
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`${SPINE_NAV_SELECTOR} [aria-current="true"]`)?.focus();
      });
    }

    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [appScreen, menuScreen, setMenuScreen, goBack]);

  return {
    backVisible: appScreen === "menu" && menuScreen !== DEFAULT_SCREEN,
    goBack,
  };
}
