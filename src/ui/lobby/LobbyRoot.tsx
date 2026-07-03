// The React lobby screen — mounted by UiRoot when useSessionStore().screen
// === "lobby" (design §9's sibling contract). Composes the header rail (room
// code + QR + copy actions), the three-column stage grid (warlocks rail /
// battleground viewport + arena filmstrip / match-setup rail), and the
// bottom launch bar (muster count, status, host-only Start Brawl) — the same
// four zones as index.html's #lobby (L542-660) / src/ui.js's showLobby().
import { gameSessionRef } from "../../loop/useGameSession";
import { useSessionStore } from "../../store/useSessionStore";
import { useUiStore } from "../../store/useUiStore";
import { useRosterStore } from "../../store/useRosterStore";
import { Button } from "../common";
import { RoomCodeQr } from "./RoomCodeQr";
import { PlayerRoster } from "./PlayerRoster";
import { BattlegroundHero } from "./BattlegroundHero";
import { MatchSetupPanel } from "./MatchSetupPanel";
import styles from "./LobbyRoot.module.css";

export function LobbyRoot() {
  const roomCode = useSessionStore((s) => s.roomCode);
  const isHost = useSessionStore((s) => s.isHost);
  const lobbyStatus = useUiStore((s) => s.lobbyStatus);
  const playerCount = useRosterStore((s) => s.playerIds.length);

  // Port of ui.js's pushLobby()/sim.canStartMatch(): the lobby screen is
  // never shown for practice mode (that flow starts the match immediately
  // on host.onReady — see useGameSession.ts's startHosting), so the only
  // gate this screen needs to replicate is the non-practice "need at least
  // 2 warlocks" minimum (sim.ts's canStartMatch()).
  const canStart = playerCount >= 2;

  return (
    <div className={styles.scene}>
      <header className={styles.headerRail}>
        <div className={styles.brand}>
          <span className={styles.eyebrow}>Staging Grounds</span>
          <h2 className={styles.wordmark}>LOBBY</h2>
        </div>
        <RoomCodeQr roomCode={roomCode} />
      </header>

      <div className={styles.stage}>
        <PlayerRoster isHost={isHost} />
        <BattlegroundHero isHost={isHost} />
        <MatchSetupPanel isHost={isHost} />
      </div>

      <footer className={styles.launchBar}>
        <div className={styles.muster}>
          <span className={styles.musterCount}>
            {playerCount} warlock{playerCount === 1 ? "" : "s"} mustered
          </span>
          <p className={styles.status} aria-live="polite">{lobbyStatus}</p>
        </div>
        {isHost && (
          <Button
            variant="forge"
            className={styles.startBtn}
            disabled={!canStart}
            onClick={() => gameSessionRef.current?.startMatch()}
          >
            Start Brawl
          </Button>
        )}
      </footer>
    </div>
  );
}
