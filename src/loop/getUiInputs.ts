// The UI-input adapter (design §3, point 2). `useGameSession` needs to READ
// a handful of player-controlled inputs (name/character/bot settings/arena
// settings/mobs toggle/social prefs) — P6 deletes the legacy `ui.getX()` DOM
// path this used to branch on (design §3's original problem statement);
// this module now just reads the P5a store extensions
// (useLobbyConfigStore/useSocialPrefsStore) plus the already-frozen
// useSettingsStore (name/character) unconditionally, so every INPUT
// read-site in useGameSession still routes through ONE function instead of
// re-deriving these fields inline.
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

export function getUiInputs(): UiInputs {
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
