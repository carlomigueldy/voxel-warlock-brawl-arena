// The UI-input adapter (design §3, point 2 — "the ONE additive edit to
// useGameSession"). `useGameSession` needs to READ a handful of
// player-controlled inputs (name/character/bot settings/arena settings/mobs
// toggle/social prefs) regardless of which UI is presenting the controls.
// Under `?ui=legacy` those inputs live on the live legacy `getUI()` DOM
// singleton (unchanged — see design §3's problem statement); under
// `?ui=react` they live on the P5a store extensions
// (useLobbyConfigStore/useSocialPrefsStore) plus the already-frozen
// useSettingsStore (name/character). This module is the single place that
// decides which source is active, so every `ui.getX()` INPUT read-site in
// useGameSession routes through ONE function instead of each call site
// re-deriving the branch.
//
// `mode` defaults to the real UI_MODE flag (read once at module load, same
// as every other flag-gated seam in this app) but is an explicit parameter
// so both branches are unit-testable without needing to reload the flags
// module against a different `location.search` — see getUiInputs.test.ts.
//
// OUTPUT writes (ui.showLobby(), ui.setMenuStatus(), the store dual-writes,
// ...) are explicitly OUT of scope here — design §3 point 2 keeps those as
// harmless legacy-setter no-ops in react mode until P6 deletes ui.js.
import { UI_MODE, type UiMode } from "../config/flags";
import { CFG } from "../config.js";
import { getUI } from "../services/registry";
import { useSettingsStore } from "../store/useSettingsStore";
import { useLobbyConfigStore } from "../store/useLobbyConfigStore";
import { useSocialPrefsStore } from "../store/useSocialPrefsStore";
import type { ObstacleTypeId } from "../types";

export interface BotSettingsInput {
  count: number;
  skill: string;
}

export interface ArenaSettingsInput {
  arenaWorld: string;
  landSize: string;
  enabledObstacles: Record<ObstacleTypeId, boolean>;
}

export interface SocialPrefsInput {
  micEnabled: boolean;
  masterVolume: number;
  showBubbles: boolean;
  pttKey: string;
}

export interface UiInputs {
  name: string;
  character: string;
  botSettings: BotSettingsInput;
  arenaSettings: ArenaSettingsInput;
  mobsEnabled: boolean;
  socialPrefs: SocialPrefsInput;
}

export function getUiInputs(mode: UiMode = UI_MODE): UiInputs {
  if (mode === "legacy") {
    const ui = getUI();
    return {
      name: ui.getName(),
      // ui.js's own getCharacter() always returns a validated string in
      // practice (_initialCharacter() falls back to CFG.DEFAULT_CHARACTER),
      // but its inferred (checkJs: false) JS type is looser — coalesce here
      // rather than widen UiInputs.character to `string | null` for every
      // caller (useSettingsStore's react-mode `character` is never null).
      character: ui.getCharacter() ?? CFG.DEFAULT_CHARACTER,
      botSettings: ui.getBotSettings(),
      arenaSettings: ui.getArenaSettings(),
      mobsEnabled: ui.mobsEnabled(),
      socialPrefs: ui.getSocialPrefs(),
    };
  }

  const settings = useSettingsStore.getState();
  const lobby = useLobbyConfigStore.getState();
  const social = useSocialPrefsStore.getState();
  return {
    name: settings.name,
    character: settings.character,
    botSettings: { count: lobby.botCount, skill: lobby.botSkill },
    arenaSettings: { arenaWorld: lobby.arenaWorld, landSize: lobby.landSize, enabledObstacles: lobby.enabledObstacles },
    mobsEnabled: lobby.mobsEnabled,
    socialPrefs: {
      micEnabled: social.micEnabled,
      masterVolume: social.masterVolume,
      showBubbles: social.showBubbles,
      pttKey: social.pttKey,
    },
  };
}
