// Battleground viewport (map hero) + host-only arena-world filmstrip — port
// of ui.js's renderMapHero (src/ui.js:1504-1523) and _buildArenaCards/
// _selectArena (src/ui.js:169-209). Both pieces are returned as siblings (no
// wrapping element) so they land as direct children of LobbyRoot's .stage
// CSS grid — grid-area is declared on each piece's own root (see
// BattlegroundHero.module.css), same placement legacy achieved by giving
// .lobby-battleground and .lobby-filmstrip-field their own grid-area.
//
// Client view renders only the read-only hero (no cards) — matches
// ui.js's showLobby()/renderLobbyConfig() split, where #arena-world-ui only
// ever gets built once (host-side) and clients just see renderMapHero()
// driven by the config broadcast in MSG.LOBBY.
import type { CSSProperties } from "react";
import { CFG, getArenaHazard } from "../../config.js";
import type { ArenaWorld } from "../../types";
import { gameSessionRef } from "../../loop/useGameSession";
import { useLobbyConfigStore } from "../../store/useLobbyConfigStore";
import { hex } from "./hexColor";
import styles from "./BattlegroundHero.module.css";

export interface BattlegroundHeroProps {
  isHost: boolean;
}

export function BattlegroundHero({ isHost }: BattlegroundHeroProps) {
  const arenaWorld = useLobbyConfigStore((s) => s.arenaWorld);
  const world = CFG.ARENA_WORLDS.find((w) => w.id === arenaWorld) ?? CFG.ARENA_WORLDS[0]!;
  const hazard = getArenaHazard(world.id);

  const battlegroundStyle = { "--stage-hazard": hex(hazard.glow) } as CSSProperties;
  const heroStyle = {
    "--hero-top": hex(world.top),
    "--hero-side": hex(world.side),
    "--hero-hazard": hex(hazard.color),
    "--hero-glow": hex(hazard.glow),
  } as CSSProperties;

  return (
    <>
      <section className={styles.battleground} aria-label="Battleground" style={battlegroundStyle}>
        <div className={styles.viewport}>
          <div className={styles.mapHero} style={heroStyle} aria-live="polite">
            <span className={styles.heroHazardGlow} />
            <span className={styles.heroPlatform} />
            <span className={styles.heroMotif} data-hazard={hazard.detail?.kind || ""} aria-hidden="true" />
            <span className={styles.heroCopy}>
              <span className={styles.heroWorld}>{world.name}</span>
              <span className={styles.heroHazardName}>{hazard.name}</span>
            </span>
          </div>
        </div>
      </section>
      {isHost && (
        <div className={styles.filmstripField}>
          <span className={styles.filmstripLabel}>Arena world</span>
          <div className={styles.cards} role="radiogroup" aria-label="Arena world">
            {CFG.ARENA_WORLDS.map((w) => (
              <ArenaCard
                key={w.id}
                world={w}
                active={w.id === arenaWorld}
                onSelect={() => {
                  useLobbyConfigStore.getState().setArenaWorld(w.id);
                  gameSessionRef.current?.configChange();
                }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ArenaCard({ world, active, onSelect }: { world: ArenaWorld; active: boolean; onSelect: () => void }) {
  const hazard = getArenaHazard(world.id);
  const cardStyle = {
    "--card-top": hex(world.top),
    "--card-side": hex(world.side),
    "--card-hazard": hex(hazard.color),
    "--card-glow": hex(hazard.glow),
  } as CSSProperties;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={[styles.card, active && styles.cardActive].filter(Boolean).join(" ")}
      style={cardStyle}
      onClick={onSelect}
    >
      <span className={styles.cardArt}>
        <span className={styles.cardPlatform} />
        <span className={styles.cardHazardGlow} />
        <span className={styles.cardMotif} data-hazard={hazard.detail?.kind || ""} aria-hidden="true" />
      </span>
      <span className={styles.cardName}>{world.name}</span>
      <span className={styles.cardHazard}>{hazard.name}</span>
      <span className={styles.cardCheck} aria-hidden="true">✓</span>
    </button>
  );
}
