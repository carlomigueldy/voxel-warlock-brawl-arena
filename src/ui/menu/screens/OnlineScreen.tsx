// ONLINE sub-screen — port of index.html #screen-online / ui.js's region
// selector + Quick Match/cancel wiring (design §0 parity contract). Queue
// status is intentionally status-only: guard.ui #11 ("online screen uses
// queue status instead of hosted room browser") — no room list here.
import { CFG } from "../../../config.js";
import { useSettingsStore } from "../../../store/useSettingsStore";
import { useUiStore } from "../../../store/useUiStore";
import { gameSessionRef } from "../../../loop/useGameSession";
import { Button } from "../../common";
import type { RequireName } from "../MenuRoot";
import styles from "../menu.module.css";

export function OnlineScreen({ requireName }: { requireName: RequireName }) {
  const onlineEnabled = useUiStore((s) => s.onlineEnabled);
  const queue = useUiStore((s) => s.queue);
  const region = useSettingsStore((s) => s.region);
  const setRegion = useSettingsStore((s) => s.setRegion);

  function quickMatch() {
    if (!requireName()) return;
    gameSessionRef.current?.quickMatch();
  }

  function cancelQueue() {
    void gameSessionRef.current?.cancelQueue();
  }

  return (
    <div className={styles.screen} id="screen-online" role="region" aria-label="Online play">
      <h2 className={styles.screenTitle}>ONLINE PLAY</h2>
      <p className={styles.screenDesc}>
        Queue into a hidden 1v1. We start in your home region, then widen automatically.
      </p>

      {!onlineEnabled && (
        <div className={styles.supabaseNotice} role="alert">
          <span className={styles.supabaseNoticeIcon} aria-hidden="true">
            ⚠
          </span>
          <p>Connect a Supabase project to enable online play &amp; leaderboards.</p>
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="menu-region-select">
          Region
        </label>
        <div className={styles.runeSelectWrap}>
          <select
            id="menu-region-select"
            className={styles.runeSelect}
            aria-label="Select matchmaking region"
            disabled={!onlineEnabled}
            value={region}
            onChange={(e) => setRegion(e.currentTarget.value)}
          >
            {CFG.REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <span className={styles.runeSelectArrow} aria-hidden="true">
            ▾
          </span>
        </div>
      </div>

      {!queue.searching && (
        <Button variant="forge" className={styles.btnHero} disabled={!onlineEnabled} onClick={quickMatch}>
          Quick Match
        </Button>
      )}

      <div className={styles.queuePanel} aria-live="polite">
        <span className={styles.fieldLabel}>Queue status</span>
        <p id="online-queue-status" className={styles.queueStatus}>
          {queue.status || "Search your home region first. We widen the queue automatically."}
        </p>
        {queue.searching && queue.canCancel && (
          <Button variant="ghost" id="btn-cancel-queue" onClick={cancelQueue}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
