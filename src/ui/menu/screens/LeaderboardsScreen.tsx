// LEADERBOARDS sub-screen — port of index.html #screen-leaderboards /
// ui.js's `_buildLeaderboardControls`/`renderLeaderboard` (design §0 parity
// contract). Under `?ui=legacy`, `wireLegacyUiToStores`'s `screenChange`/
// `leaderboardChange` handlers own the `fetchLeaderboard()` call — those
// only fire for the legacy DOM's own `ui.on(...)` emitter, so under
// `?ui=react` this component is the direct store reader/writer replacing
// that bridge (mirrors `useGameSession`'s own doc comment on the split).
import { useEffect, useState } from "react";
import { useSettingsStore } from "../../../store/useSettingsStore";
import { useUiStore, type LeaderboardScope } from "../../../store/useUiStore";
import { isEnabled } from "../../../supabase.js";
import { fetchLeaderboard } from "../../../leaderboard.js";
import type { LeaderboardMetric } from "../../../types";
import { SegmentedControl } from "../../common";
import styles from "../menu.module.css";

const METRICS: { value: LeaderboardMetric; label: string }[] = [
  { value: "wins", label: "Wins" },
  { value: "kd", label: "K/D" },
  { value: "roundWins", label: "Rounds" },
  { value: "rating", label: "Rating" },
];
const SCOPES: { value: LeaderboardScope; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "region", label: "My Region" },
];
const METRIC_LABEL: Record<LeaderboardMetric, string> = { wins: "Wins", kd: "K/D", roundWins: "Rounds", rating: "Rating" };

export function LeaderboardsScreen() {
  const leaderboard = useUiStore((s) => s.leaderboard);
  const homeRegion = useSettingsStore((s) => s.region);
  const [loading, setLoading] = useState(false);
  const online = isEnabled();

  async function load(metric: LeaderboardMetric, scope: LeaderboardScope) {
    if (!online) return;
    setLoading(true);
    try {
      const rows = await fetchLeaderboard({ region: scope === "region" ? homeRegion : null, metric, limit: 20 });
      useUiStore.getState().setLeaderboard(rows || [], { metric, scope });
    } finally {
      setLoading(false);
    }
  }

  // Port of ui.js's screenChange("leaderboards") handler — fetches the
  // default (wins/global) view the moment this screen mounts.
  useEffect(() => {
    void load(leaderboard.metric, leaderboard.scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.screen} id="screen-leaderboards" role="region" aria-label="Leaderboards">
      <h2 className={styles.screenTitle}>LEADERBOARDS</h2>

      {!online && (
        <div className={styles.supabaseNotice} role="alert">
          <span className={styles.supabaseNoticeIcon} aria-hidden="true">
            ⚠
          </span>
          <p>Connect a Supabase project to view leaderboards.</p>
        </div>
      )}

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Metric</span>
        <SegmentedControl
          options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
          value={leaderboard.metric}
          ariaLabel="Leaderboard metric"
          onChange={(metric) => void load(metric, leaderboard.scope)}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Scope</span>
        <SegmentedControl
          size="sm"
          options={SCOPES.map((s) => ({ value: s.value, label: s.label }))}
          value={leaderboard.scope}
          ariaLabel="Leaderboard scope"
          onChange={(scope) => void load(leaderboard.metric, scope)}
        />
      </div>

      <div className={styles.leaderboardTable} id="leaderboard-table" role="table" aria-label="Rankings">
        <div className={[styles.lbRow, styles.lbHeader].join(" ")} role="row">
          <span>#</span>
          <span>Warlock</span>
          <span className={styles.lbValue}>{METRIC_LABEL[leaderboard.metric]}</span>
        </div>
        {leaderboard.rows.length === 0 ? (
          <p className={styles.lbEmpty}>{loading ? "Loading…" : "No data yet — play some matches!"}</p>
        ) : (
          leaderboard.rows.map((row, i) => (
            <div key={String(row.userId ?? i)} className={[styles.lbRow, i === 0 && styles.lbTop].filter(Boolean).join(" ")} role="row">
              <span className={styles.lbRank}>{i + 1}</span>
              <span className={styles.lbName}>
                {(row.username as string) || (row.userId ? String(row.userId).slice(0, 8) + "…" : "—")}
              </span>
              <span className={styles.lbValue}>{String(row[leaderboard.metric] ?? "—")}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
