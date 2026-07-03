// TUTORIAL sub-screen — port of index.html #screen-tutorial / ui.js's
// `_bindTutorialTabs`/`_buildTutorialSpellbook`/Practice Mode CTA (design §0
// parity contract). Practice mirrors the host flow but starts immediately,
// same as legacy's `btnPractice` handler.
import { useState } from "react";
import { SPELLS, SPELL_ORDER } from "../../../config.js";
import { useSettingsStore } from "../../../store/useSettingsStore";
import { gameSessionRef } from "../../../loop/useGameSession";
import { Button } from "../../common";
import type { RequireName } from "../MenuRoot";
import styles from "../menu.module.css";

type TutTab = "basics" | "goal" | "controls" | "spellbook" | "tips";
const TABS: { id: TutTab; label: string }[] = [
  { id: "basics", label: "Basics" },
  { id: "goal", label: "Goal & Arena" },
  { id: "controls", label: "Controls" },
  { id: "spellbook", label: "Spellbook" },
  { id: "tips", label: "Tips" },
];

const WORLDS = [
  { color: "#6c4cff", name: "Classic Circle", hazard: "Lava Sea" },
  { color: "#4cc9ff", name: "Twin Islands", hazard: "Ocean" },
  { color: "#ffd23c", name: "Narrow Bridge", hazard: "Toxic Swamp" },
  { color: "#7cff5a", name: "Arcane Cross", hazard: "Sharp Rocks" },
  { color: "#ff4ca8", name: "Outer Ring", hazard: "Arcane Abyss" },
];

const TIPS = [
  "Build charge first. Let Fireball stack charge on an enemy before throwing a high-knockback spell — a fully charged target can be launched off the platform in one hit.",
  "Hold the high ground. Plateaus let your shots connect downhill while incoming fire skims beneath you. Reach them via ramps — not ledges (fall-stun).",
  "Watch the shrink. The arena starts shrinking after 8 s. Back-pedaling into a shrinking edge is a self-elimination.",
  "Counter with Shield. One Shield absorbs the next hit entirely — save it to eat a Meteor or Homing bolt at full charge and keep your position.",
  "Teleport off hazards. If you land in lava or ocean, Teleport back to the platform before the 3.5 s death timer runs out.",
  "Stay mobile. Move speed is 9 u/s. A stationary warlock is easy prey for Homing bolts and Meteor strikes.",
];

const SPELL_GROUPS = [
  { label: "Projectiles", ids: SPELL_ORDER.slice(0, 8) },
  { label: "Mobility", ids: SPELL_ORDER.slice(8, 13) },
  { label: "Control / Utility", ids: SPELL_ORDER.slice(13) },
];

const hex = (n: number) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);

export function TutorialScreen({ requireName }: { requireName: RequireName }) {
  const [tab, setTab] = useState<TutTab>("basics");
  const character = useSettingsStore((s) => s.character);

  function startPractice() {
    const name = requireName() || "Warlock";
    gameSessionRef.current?.practice(name, { character });
  }

  return (
    <div className={styles.screen} id="screen-tutorial" role="region" aria-label="How to play">
      <h2 className={styles.screenTitle}>TUTORIAL</h2>
      <p className={styles.screenDesc}>Learn the rules, master your spells, last warlock wins.</p>

      <div className={styles.tutTabs} role="tablist" aria-label="Tutorial sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            className={[styles.tutTab, tab === t.id && styles.tutTabActive].filter(Boolean).join(" ")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.tutScrollArea} tabIndex={0} role="group" aria-label="Tutorial content">
        {tab === "basics" && (
          <dl className={styles.tutFacts}>
            <div className={styles.tutFact}>
              <dt>No health bars</dt>
              <dd>
                Each hit adds <strong>charge</strong> to the target. The higher the charge, the farther they fly on the next
                hit — knock them off the platform to eliminate them.
              </dd>
            </div>
            <div className={styles.tutFact}>
              <dt>Charge mechanics</dt>
              <dd>
                Base knockback <strong>8</strong>. Every hit adds <strong>+0.14</strong> charge (cap <strong>4.0</strong>).
                Extra impulse = charge × 11. Charge decays at <strong>0.05/s</strong> while you're alive.
              </dd>
            </div>
            <div className={styles.tutFact}>
              <dt>Hazard timer</dt>
              <dd>
                Fall into the hazard below and you have <strong>3.5 s</strong> to return. Stay too long and you're eliminated
                for that round.
              </dd>
            </div>
            <div className={styles.tutFact}>
              <dt>Fall-stun</dt>
              <dd>
                Drop off a ledge ≥ <strong>1.5 u</strong> tall and you're stunned <strong>2 s</strong> on landing. Ramps never
                trigger it.
              </dd>
            </div>
          </dl>
        )}

        {tab === "goal" && (
          <dl className={styles.tutFacts}>
            <div className={styles.tutFact}>
              <dt>Win condition</dt>
              <dd>
                Last warlock standing wins the round. First to <strong>5 round wins</strong> wins the match. Supports up to{" "}
                <strong>6 warlocks</strong>.
              </dd>
            </div>
            <div className={styles.tutFact}>
              <dt>Arena shrink</dt>
              <dd>
                Platform starts at radius <strong>18</strong>. After <strong>8 s</strong> it shrinks at{" "}
                <strong>0.30 u/s</strong> until it reaches minimum radius <strong>6</strong>.
              </dd>
            </div>
            <div className={styles.tutFact}>
              <dt>5 arena worlds</dt>
              <dd>
                <ul className={styles.tutWorldList}>
                  {WORLDS.map((w) => (
                    <li key={w.name}>
                      <span className={styles.tutWorldDot} style={{ ["--wc" as string]: w.color }} aria-hidden="true" />
                      <strong>{w.name}</strong> — {w.hazard}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        )}

        {tab === "controls" && (
          <div className={styles.tutControlsGrid}>
            <div className={styles.tutControlRow}>
              <span className={styles.tutControlAction}>Move</span>
              <div className={styles.tutKeys}>
                <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd>
              </div>
            </div>
            <div className={styles.tutControlRow}>
              <span className={styles.tutControlAction}>Aim</span>
              <div className={styles.tutKeys}>Mouse</div>
            </div>
            <div className={styles.tutControlRow}>
              <span className={styles.tutControlAction}>Cast spell</span>
              <div className={styles.tutKeys}>
                {["1", "2", "3", "4", "5", "6", "7", "8", "Q", "E", "R", "F", "C", "V", "X", "Z", "T", "G", "B", "H"].map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </div>
            </div>
            <p className={styles.hint}>Spell hotkeys are rebindable in the Account screen.</p>
          </div>
        )}

        {tab === "spellbook" && (
          <div>
            {SPELL_GROUPS.map((group) => (
              <div className={styles.tutSpellGroup} key={group.label}>
                <h3 className={styles.tutSpellGroupTitle}>{group.label}</h3>
                {group.ids.map((id) => {
                  const s = SPELLS[id];
                  if (!s) return null;
                  return (
                    <div className={styles.tutSpellRow} key={id} style={{ ["--spell-color" as string]: hex(s.color) }}>
                      <span className={styles.tutSpellSwatch} aria-hidden="true" />
                      <span className={styles.tutSpellKey}>{s.key}</span>
                      <div className={styles.tutSpellInfo}>
                        <span className={styles.tutSpellName}>{s.name}</span>
                        <span className={styles.tutSpellDesc}>{s.desc}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {tab === "tips" && (
          <ul className={styles.tutTipsList}>
            {TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.tutPracticeCta}>
        <Button variant="forge" id="btn-practice" onClick={startPractice}>
          Practice Mode
        </Button>
        <p className={styles.tutPracticeHint}>
          Pick any spell loadout, then spawn dummy targets on demand — no bots, no shrinking arena, you can't die.
        </p>
      </div>
    </div>
  );
}
