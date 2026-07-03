// "The Bound Reliquary" — port of ui.js's updateHUD HP/charge/cast block
// (design §9 scope: "HP bar (hp/mhp), charge bar, cast bar (cast)").
//
// Status icons (buff/debuff chips) are intentionally not rendered here: they
// key off per-player snapshot flags (sl/bu/cu/st/iv/hs) that the frozen
// useHudStore HudView (design §2, read-only for this PR) does not surface —
// see PR description for the tracked follow-up.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CFG, SPELLS } from "../../config.js";
import type { ActiveCastSnap } from "../../types";
import styles from "./Hud.module.css";

export interface VitalsProps {
  hp: number;
  mhp: number;
  charge: number;
  cast: ActiveCastSnap | null;
}

export function Vitals({ hp, mhp, charge, cast }: VitalsProps) {
  const tier = Math.max(0, Math.min(CFG.CHARGE_MAX, Math.floor(charge)));

  // One-shot full-charge "ignition" bloom (mirrors ui.js's _pulseClass on
  // #vitals) — fires only on the tier transition into CHARGE_MAX, not on
  // every render at max tier.
  const prevTierRef = useRef(tier);
  const [igniting, setIgniting] = useState(false);
  useEffect(() => {
    if (tier >= CFG.CHARGE_MAX && prevTierRef.current < CFG.CHARGE_MAX) {
      setIgniting(true);
      const timer = setTimeout(() => setIgniting(false), 500);
      prevTierRef.current = tier;
      return () => clearTimeout(timer);
    }
    prevTierRef.current = tier;
  }, [tier]);

  const hpPct = mhp ? Math.max(0, Math.min(100, (hp / mhp) * 100)) : 0;
  const chargePct = Math.min(100, (charge / CFG.CHARGE_MAX) * 100);

  const vitalsCls = [
    styles.vitals,
    tier >= 1 && styles.chargeTier1,
    tier >= 2 && styles.chargeTier2,
    tier >= 3 && styles.chargeTier3,
    tier >= 4 && styles.chargeTier4,
    igniting && styles.ignite,
  ]
    .filter(Boolean)
    .join(" ");

  const hpWrapCls = [styles.hpWrap, hpPct < 25 && styles.hpLow, hpPct >= 25 && hpPct < 60 && styles.hpMid]
    .filter(Boolean)
    .join(" ");

  const hpPctVar = { "--hp-pct": `${hpPct}%` } as CSSProperties;

  return (
    <div className={vitalsCls} data-testid="vitals">
      <div className={hpWrapCls}>
        <div className={styles.hpTrack}>
          <div className={styles.hpChip} style={hpPctVar} />
          <div className={styles.hpBar} style={hpPctVar} />
        </div>
        <span className={styles.hpText}>
          {Math.ceil(hp)}/{mhp}
        </span>
      </div>

      <div className={styles.chargeWrap}>
        <div className={styles.chargeBar} style={{ width: `${chargePct}%` }} />
        <div className={styles.chargeShimmer} style={{ "--shimmer-on": charge > 0 ? 1 : 0 } as CSSProperties} />
        <div className={styles.chargeSpark} />
      </div>

      {cast && (
        <div className={[styles.castWrap, cast.c === 1 ? styles.channeling : styles.casting].join(" ")}>
          <div className={styles.castBar} style={{ width: `${Math.round(cast.p * 100)}%` }} />
          <span className={styles.castLabel}>
            {SPELLS[cast.s]?.name || ""}
            {cast.c ? " (channeling)" : " (casting)"}
          </span>
        </div>
      )}
    </div>
  );
}
