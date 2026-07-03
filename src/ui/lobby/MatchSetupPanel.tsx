// Host-only match-config fields (land size / map objects / mobs) or, for a
// joined client, the read-only summary — port of ui.js's _buildLandSizeSegmented
// (src/ui.js:211-227), _buildMapObjectsToggles/_saveMapObjects/_getEnabledObstacles
// (src/ui.js:286-338), _buildMobsToggle (src/ui.js:154-167), and
// renderLobbyConfig (src/ui.js:1529-1544) / index.html L608-643.
//
// KNOWN GAP (flagged for a follow-up, out of this sibling's owned-directory
// scope): under `?ui=legacy`, a joined client's summary is filled from the
// host's broadcast MSG.LOBBY `config` payload (useGameSession.ts's onLobby
// handler calls `ui.renderLobbyConfig(msg.config, ...)` directly against the
// legacy DOM). No store currently mirrors that broadcast payload for react
// mode — useLobbyConfigStore is written only by the LOCAL user's own
// controls (host inputs `getUiInputs()` reads), so a joined client's summary
// below reflects this browser's own store defaults, not the host's actual
// choices, until useGameSession.ts's onLobby also writes the broadcast
// config into a store (that edit touches shared session-hook territory
// outside src/ui/lobby/, so it's left for a fast-follow rather than done
// here). This does not affect the host-side fields below, which are fully
// live (guard.ui #9 equivalent).
import { CFG } from "../../config.js";
import type { ObstacleTypeId } from "../../types";
import { gameSessionRef } from "../../loop/useGameSession";
import { useLobbyConfigStore } from "../../store/useLobbyConfigStore";
import { SegmentedControl, Toggle, type SegmentedOption } from "../common";
import styles from "./MatchSetupPanel.module.css";

const LAND_SIZE_OPTIONS: SegmentedOption[] = Object.values(CFG.ARENA_LAND_SIZES).map((size) => ({
  value: size.id,
  label: size.name,
}));

export interface MatchSetupPanelProps {
  isHost: boolean;
}

export function MatchSetupPanel({ isHost }: MatchSetupPanelProps) {
  return isHost ? <HostFields /> : <ClientSummary />;
}

function HostFields() {
  const landSize = useLobbyConfigStore((s) => s.landSize);
  const enabledObstacles = useLobbyConfigStore((s) => s.enabledObstacles);
  const mobsEnabled = useLobbyConfigStore((s) => s.mobsEnabled);

  return (
    <div className={styles.panel}>
      <p className={styles.railTitle}>Match Setup</p>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Land size</span>
        <SegmentedControl
          ariaLabel="Land size"
          options={LAND_SIZE_OPTIONS}
          value={landSize}
          onChange={(id) => {
            useLobbyConfigStore.getState().setLandSize(id);
            gameSessionRef.current?.configChange();
          }}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Map objects</span>
        <div className={styles.mapToggles} role="group" aria-label="Map object types">
          {CFG.OBSTACLE_TYPES.map(({ id, label }) => (
            <ObstacleToggle
              key={id}
              id={id}
              label={label}
              checked={enabledObstacles[id] !== false}
              onChange={(checked) => {
                useLobbyConfigStore.getState().setObstacleEnabled(id, checked);
                gameSessionRef.current?.configChange();
              }}
            />
          ))}
        </div>
      </div>
      <div className={[styles.field, styles.fieldInline].join(" ")}>
        <div className={styles.fieldCopy}>
          <span className={styles.fieldLabel} id="mobs-label">Mob spawns</span>
          <span className={styles.fieldHint}>Neutral mobs spawn during matches and drop ability runes</span>
        </div>
        <Toggle
          checked={mobsEnabled}
          ariaLabel="Mob spawns"
          onChange={(checked) => {
            useLobbyConfigStore.getState().setMobsEnabled(checked);
            gameSessionRef.current?.configChange();
          }}
        />
      </div>
    </div>
  );
}

function ObstacleToggle({ id, label, checked, onChange }: { id: ObstacleTypeId; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={[styles.obsToggle, checked && styles.obsToggleOn].filter(Boolean).join(" ")}>
      <input
        type="checkbox"
        className={styles.obsToggleCheck}
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.obsToggleTrack}><span className={styles.obsToggleKnob} /></span>
      <span className={styles.obsToggleLabel}>{label}</span>
    </label>
  );
}

function ClientSummary() {
  // See this file's header — a joined client's store isn't yet fed by the
  // host's broadcast config, so this renders the local store's own state
  // (best-effort placeholder) rather than the real per-peer values.
  const landSize = useLobbyConfigStore((s) => s.landSize);
  const mobsEnabled = useLobbyConfigStore((s) => s.mobsEnabled);
  const enabledObstacles = useLobbyConfigStore((s) => s.enabledObstacles);
  const landSizeName = CFG.ARENA_LAND_SIZES[landSize]?.name ?? CFG.ARENA_LAND_SIZES[CFG.DEFAULT_ARENA_LAND_SIZE]!.name;
  const objectCount = Object.values(enabledObstacles).filter(Boolean).length;
  const totalObjects = CFG.OBSTACLE_TYPES.length;

  return (
    <div className={[styles.panel, styles.summaryPanel].join(" ")} aria-live="polite">
      <p className={styles.railTitle}>Match Setup</p>
      <p className={styles.summaryRow}>
        <span className={styles.fieldLabel}>Land size</span>
        <span>{landSizeName}</span>
      </p>
      <p className={styles.summaryRow}>
        <span className={styles.fieldLabel}>Mob spawns</span>
        <span>{mobsEnabled !== false ? "On" : "Off"}</span>
      </p>
      <p className={styles.summaryRow}>
        <span className={styles.fieldLabel}>Map objects</span>
        <span>{objectCount}/{totalObjects}</span>
      </p>
    </div>
  );
}
