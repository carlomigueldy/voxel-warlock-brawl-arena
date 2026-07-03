// PRIVATE sub-screen — port of index.html #screen-private / ui.js's
// Host/Join wiring (design §0 parity contract). Host just creates the room;
// the arena/bot/mobs CONFIG controls legacy read at host-time now live on
// `useLobbyConfigStore` and are applied once inside the lobby screen
// (#162 p5-lobby-qr's `bots()`/`configChange()` intents) — out of this PR's
// scope per the p5-menu brief.
import { useState, type KeyboardEvent } from "react";
import { useSettingsStore } from "../../../store/useSettingsStore";
import { useUiStore } from "../../../store/useUiStore";
import { gameSessionRef } from "../../../loop/useGameSession";
import { Button } from "../../common";
import type { RequireName } from "../MenuRoot";
import styles from "../menu.module.css";

export function PrivateScreen({ requireName }: { requireName: RequireName }) {
  const character = useSettingsStore((s) => s.character);
  const [code, setCode] = useState("");

  function hostGame() {
    const name = requireName();
    if (!name) return;
    gameSessionRef.current?.hostPrivate(name, { character });
  }

  function tryJoin() {
    const name = requireName();
    if (!name) return;
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      useUiStore.getState().setMenuStatus("Enter a valid room code.");
      return;
    }
    gameSessionRef.current?.join(name, trimmed, character);
  }

  function onCodeKeydown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") tryJoin();
  }

  return (
    <div className={styles.screen} id="screen-private" role="region" aria-label="Private or direct game">
      <h2 className={styles.screenTitle}>PRIVATE</h2>
      <p className={styles.screenDesc}>Host a private game or join by room code — no account needed.</p>

      <Button variant="forge" id="btn-host" className={styles.btnHero} onClick={hostGame}>
        Host Game
      </Button>

      <div className={styles.privateDivider} aria-hidden="true">
        <span>— or —</span>
      </div>

      <div className={styles.joinBox}>
        <div className={styles.runeCode}>
          <input
            id="join-code"
            maxLength={6}
            placeholder="ROOM CODE"
            autoComplete="off"
            spellCheck={false}
            aria-label="Room code"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
            onKeyDown={onCodeKeydown}
          />
        </div>
        <Button variant="ghost" id="btn-join" onClick={tryJoin}>
          Join
        </Button>
      </div>
    </div>
  );
}
