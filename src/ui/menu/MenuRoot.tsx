// The React main menu (design §9 UiRoot contract, screen==="menu") — port of
// index.html's #menu cinematic layout + ui.js's spine nav/name-field/status
// wiring (design §0 parity contract). Mounted once from UiRoot; owns the
// spine (brand, name field, nav, status) and swaps in the active sub-screen
// component from `useMenuNavStore` — the same six sub-screens ui.js's
// `_showMenuScreen` toggles (online | private | characters | leaderboards |
// account | tutorial).
//
// Deviation from legacy: ui.js keeps all six sub-screens permanently in the
// DOM and toggles visibility with CSS (so a slide transition can animate
// between them — p5-juice/#168's territory, not this PR's). This component
// only mounts the ACTIVE screen; `useMenuNavStore`/`useUiStore`/
// `useSettingsStore` already hold every bit of state a screen needs
// (character selection, queue status, leaderboard rows, auth view, ...), so
// nothing is lost across a screen switch — just the very-short-lived local
// state of an unmounted screen (e.g. an in-progress auth tab choice).
import { useRef, useState } from "react";
import { useMenuNavStore, type MenuScreen } from "../../store/useMenuNavStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { useFx } from "../../hooks/useFx";
import styles from "./menu.module.css";
import { OnlineScreen } from "./screens/OnlineScreen";
import { PrivateScreen } from "./screens/PrivateScreen";
import { CharactersScreen } from "./screens/CharactersScreen";
import { LeaderboardsScreen } from "./screens/LeaderboardsScreen";
import { AccountScreen } from "./screens/AccountScreen";
import { TutorialScreen } from "./screens/TutorialScreen";

/** Returns the validated (trimmed, <=14 char) name, or null + surfaces a
 * validation error — port of ui.js's `_flagNameError()` (name required
 * before Host/Join/Quick Match/Practice). Screens that gate an entry action
 * on a name receive this via props rather than each re-deriving the name
 * field's error state. */
export interface RequireName {
  (): string | null;
}

const SPINE_ITEMS: { screen: MenuScreen; label: string; icon: string; play?: boolean }[] = [
  { screen: "online", label: "ONLINE", icon: "▶", play: true },
  { screen: "private", label: "PRIVATE", icon: "⌁" },
  { screen: "characters", label: "CHARACTERS", icon: "✦" },
  { screen: "leaderboards", label: "RANKS", icon: "⊞" },
  { screen: "account", label: "ACCOUNT", icon: "◉" },
  { screen: "tutorial", label: "TUTORIAL", icon: "📖" },
];

export function MenuRoot() {
  const screen = useMenuNavStore((s) => s.screen);
  const setScreen = useMenuNavStore((s) => s.setScreen);
  const name = useSettingsStore((s) => s.name);
  const setName = useSettingsStore((s) => s.setName);
  const menuStatus = useUiStore((s) => s.menuStatus);
  const fx = useFx();
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const requireName: RequireName = () => {
    const trimmed = name.trim().slice(0, 14);
    if (trimmed) {
      setNameError(null);
      return trimmed;
    }
    const msg = "Name your warlock first.";
    setNameError(msg);
    useUiStore.getState().setMenuStatus(msg);
    fx.shake(5);
    nameInputRef.current?.focus();
    return null;
  };

  return (
    <div className={["overlay", styles.shell].join(" ")} data-testid="menu-root">
      <nav className={styles.spine} aria-label="Main menu">
        <header className={styles.brand}>
          <span className={styles.eyebrow}>Arena Brawler · P2P</span>
          <h1 className={styles.title}>
            <span className={[styles.titleLine, styles.lineVoxel].join(" ")}>VOXEL</span>
            <span className={[styles.titleLine, styles.lineWarlock].join(" ")}>WARLOCK</span>
            <span className={[styles.titleLine, styles.lineBrawl].join(" ")}>BRAWL</span>
          </h1>
          <p className={styles.tag}>Blast rivals off the platform. Last warlock standing wins.</p>
        </header>

        <div className={styles.nameField}>
          <label className={styles.fieldLabel} htmlFor="menu-name-input">
            Warlock name
          </label>
          <div className={styles.runeField}>
            <input
              id="menu-name-input"
              ref={nameInputRef}
              maxLength={14}
              placeholder="Name your warlock"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={nameError ? "menu-name-error" : undefined}
              aria-invalid={nameError ? true : undefined}
              className={nameError ? styles.inputError : undefined}
              value={name}
              onChange={(e) => {
                const next = e.currentTarget.value.slice(0, 14);
                setName(next);
                if (next.trim()) setNameError(null);
              }}
            />
          </div>
          {nameError && (
            <p id="menu-name-error" className={styles.fieldError} role="alert">
              {nameError}
            </p>
          )}
        </div>

        <ul className={styles.spineNav} role="list">
          {SPINE_ITEMS.map((item) => {
            const active = screen === item.screen;
            return (
              <li key={item.screen}>
                <button
                  type="button"
                  className={[styles.spineBtn, item.play && styles.spineBtnPlay, active && styles.spineBtnActive]
                    .filter(Boolean)
                    .join(" ")}
                  aria-current={active}
                  onClick={() => setScreen(item.screen)}
                >
                  <span className={styles.spineIcon} aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className={styles.status} aria-live="polite">
          {menuStatus}
        </p>

        <footer className={styles.controlsHint}>
          <p className={styles.hint}>
            Move <b>WASD</b> · Aim <b>Mouse</b>
          </p>
          <p className={styles.hint}>
            Cast <b>1-8 / Q E R F C V X Z T G B H</b>
          </p>
        </footer>
      </nav>

      <div className={styles.right}>
        {screen === "online" && <OnlineScreen requireName={requireName} />}
        {screen === "private" && <PrivateScreen requireName={requireName} />}
        {screen === "characters" && <CharactersScreen />}
        {screen === "leaderboards" && <LeaderboardsScreen />}
        {screen === "account" && <AccountScreen />}
        {screen === "tutorial" && <TutorialScreen requireName={requireName} />}
      </div>
    </div>
  );
}
