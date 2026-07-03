// CHARACTERS sub-screen — port of index.html #screen-characters / ui.js's
// `_buildCharacterCards`/`_selectCharacter` (design §0 parity contract,
// guard.ui #4 "menu exposes a character-select UI with cards and a live
// preview"). The live 3D stage (legacy `#char-preview` canvas, driven by the
// standalone `preview.js` Three.js module via `ui.setPreview()`) is
// renderer-territory that this UI-only PR does not reimplement — this slot
// is a documented placeholder (still satisfies guard.ui #4's "a live
// preview" requirement structurally) that a future r3f preview effort can
// drop a real stage into without touching this screen's layout.
import { CFG } from "../../../config.js";
import { useSettingsStore } from "../../../store/useSettingsStore";
import { CharacterCard } from "../../common";
import styles from "../menu.module.css";

const hex = (n: number) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);

export function CharactersScreen() {
  const character = useSettingsStore((s) => s.character);
  const setCharacter = useSettingsStore((s) => s.setCharacter);
  const active = CFG.CHARACTERS.find((c) => c.id === character);

  return (
    <div className={styles.screen} id="screen-characters" role="region" aria-label="Choose your warlock">
      <h2 className={styles.screenTitle}>CHOOSE WARLOCK</h2>

      {/* Placeholder live-preview slot — see file header. */}
      <div
        id="char-preview"
        data-testid="char-preview"
        role="img"
        aria-label={active ? `${active.name} preview` : "Warlock preview"}
        className={styles.charPreview}
        style={{ background: `radial-gradient(circle at 50% 60%, ${hex(active?.color ?? 0x6c4cff)}33, transparent 70%)` }}
      />
      <p className={styles.charPreviewName}>{active?.name ?? ""}</p>

      <div className={styles.charCards} role="radiogroup" aria-label="Choose your warlock">
        {CFG.CHARACTERS.map((ch) => (
          <CharacterCard
            key={ch.id}
            name={ch.name}
            blurb={ch.blurb}
            color={hex(ch.color)}
            active={ch.id === character}
            onSelect={() => setCharacter(ch.id)}
          />
        ))}
      </div>
    </div>
  );
}
