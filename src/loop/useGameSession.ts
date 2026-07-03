// The session hook — ports main.js's startHosting/startJoining/matchmaking/
// social wiring (design §6.5) into a React hook that mounts useHostLoop XOR
// useClientLoop. Host/Client/Simulation/voice are per-match; audio/input are
// page-lifetime singletons from src/services/registry.ts (design §10 risk
// 2). P6 deletes the legacy renderer/ui engines that registry used to also
// own — every intent below now writes React store state directly instead of
// dual-writing a legacy `ui` object.
//
// React UI components (DraftOverlay, PauseMenu, ...) call these intents via
// gameSessionRef rather than a prop, so — like snapshotRef/aimBridge/
// registry — the intents object is published to a module-level ref on
// mount. <GameSession/> is the only component that ever calls this hook, so
// there is exactly one writer.
import { useEffect, useRef, useState } from "react";
import { CFG, MSG, getCharacter } from "../config.js";
import { Simulation, PHASE } from "../sim.js";
import type { Player } from "../player.js";
import { Host, Client } from "../net.js";
import { VoiceChat } from "../voice.js";
import * as social from "../social.js";
import { isEnabled } from "../supabase.js";
import { getUser } from "../auth.js";
import { RegionQueue } from "../matchmaking.js";
import type { Match } from "../types";
import { submitMatchResult } from "../leaderboard.js";
import type { PlayerMeta, Snapshot } from "../types";
import { getAudio, getInput } from "../services/registry";
import { snapshotRef, setLocalId, resetSnapshotRef } from "../store/snapshotRef";
import { useSessionStore } from "../store/useSessionStore";
import { useUiStore } from "../store/useUiStore";
import { useChatStore } from "../store/useChatStore";
import { getUiInputs } from "./getUiInputs";
import { onNewSnapshot } from "./onNewSnapshot";
import { useHostLoop } from "./useHostLoop";
import { useClientLoop } from "./useClientLoop";

const ONLINE_QUEUE_IDLE_STATUS = "Search your home region first. We widen the queue automatically.";

export interface HostStartOptions {
  practice?: boolean;
  mobsEnabled?: boolean;
  arenaWorld?: string;
  landSize?: string;
  enabledObstacles?: Record<string, boolean>;
  character?: string;
  matchmaking?: { matchId: string; allowedQueueIds?: string[] } | null;
  onHostReady?: (code: string) => Promise<boolean> | boolean | void;
  onHostError?: (err: unknown) => void;
  onMatchmakingTimeout?: () => void;
}

export interface GameSessionIntents {
  // ---- frozen (design §6.5) ----
  hostPrivate(name: string, options?: HostStartOptions): void;
  join(name: string, code: string, character?: string | null): void;
  quickMatch(): void;
  leaveMatch(): Promise<void>;
  practice(name: string, options?: HostStartOptions): void;
  resume(): void;
  // ---- gameplay/social glue needed for host+practice to be playable ----
  cancelQueue(): Promise<void>;
  draft(action: unknown): void;
  spawnDummy(type: string): void;
  clearDummies(): void;
  changeLoadout(ids: string[]): void;
  toggleNoCooldown(on: boolean): void;
  bots(): void;
  configChange(): void;
  startMatch(): void;
  sendChat(text: string): void;
  sendTyping(v: boolean): void;
  sendAfk(v: boolean): void;
  sendSpeak(v: boolean): void;
  toggleMute(peerId: string): void;
  clearMutes(peerIds: string[]): void;
  socialPrefs(prefs: { masterVolume?: number; micEnabled?: boolean }): void;
}

/** Module-level publish target — see file header. Null while no GameSession
 * is mounted (e.g. before App.tsx renders it, or in a store-only unit test). */
export const gameSessionRef: { current: GameSessionIntents | null } = { current: null };

interface SocialSend {
  chat(text: string): void;
  typing(v: boolean): void;
  afk(v: boolean): void;
  speak(v: boolean): void;
}

interface SessionEngines {
  role: "host" | "client" | null;
  host: Host | null;
  client: Client | null;
  sim: Simulation | null;
}

export function useGameSession(): GameSessionIntents {
  const [engines, setEngines] = useState<SessionEngines>({ role: null, host: null, client: null, sim: null });
  const localIdRef = useRef<string | null>(null);
  // Mirror engines.host/engines.client synchronously (React state lags one
  // render behind a setEngines() call). ensureVoice()'s getPeer can be
  // invoked from within the SAME synchronous startHosting()/startJoining()
  // call that just constructed host/client (e.g. beginMatch() on the second
  // player joining) — reading React state there would risk a stale/null
  // peer if that ever raced ahead of the next commit. These refs are always
  // current.
  const hostRef = useRef<Host | null>(null);
  const clientRef = useRef<Client | null>(null);
  const voiceRef = useRef<VoiceChat | null>(null);
  const lastRosterRef = useRef<string[]>([]);
  const socialSendRef = useRef<SocialSend | null>(null);
  const onlineRef = useRef({ isOnline: false, region: null as string | null, matchResultSubmitted: false });
  const regionQueueRef = useRef<RegionQueue | null>(null);
  const matchmakingHostTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRegionRef = useRef<string>(readInitialRegion());

  const isPeerMuted = (peerId: string): boolean => {
    const m = snapshotRef.meta.get(peerId);
    return social.isMuted(peerId, m?.userId || null);
  };

  const applyChat = (relay: { fromId: string; text: string; kind: string; t: number }): void => {
    if (isPeerMuted(relay.fromId)) return;
    const meta = snapshotRef.meta.get(relay.fromId);
    const color = CFG.COLORS[(meta?.colorIndex ?? 0) % CFG.COLORS.length];
    const isSelf = relay.fromId === localIdRef.current;
    // Sole write since P6 — this used to also dual-write the legacy DOM via
    // ui.addChatLine(); useChatStore is now the only source of truth chat
    // history renders from (see useChatStore.ts's header). In-world chat
    // bubbles (legacy renderer.js's showChatBubble, gated on
    // socialPrefs.showBubbles) have no R3F equivalent and are dropped here —
    // no entity in src/three/entities/** renders text over a player's head;
    // tracked as an intentional feature gap (owner-decided separately, see
    // PR notes), not a regression to silently paper over.
    useChatStore.getState().addMessage({ name: meta?.name || "warlock", text: relay.text, color, isSelf });
  };

  function ensureVoice(): VoiceChat {
    if (voiceRef.current) return voiceRef.current;
    const voice = new VoiceChat({
      getPeer: () => (hostRef.current?.peer || clientRef.current?.peer) || null,
      getRoster: () => lastRosterRef.current,
      isMuted: isPeerMuted,
      onSpeakingChange: (on) => socialSendRef.current?.speak(on),
      getPrefs: () => getUiInputs().socialPrefs,
    });
    voiceRef.current = voice;
    if (getUiInputs().socialPrefs.micEnabled) voice.init();
    voice.updateRoster(lastRosterRef.current);
    return voice;
  }

  function clearMatchmakingHostTimeout(): void {
    if (!matchmakingHostTimeoutRef.current) return;
    clearTimeout(matchmakingHostTimeoutRef.current);
    matchmakingHostTimeoutRef.current = null;
  }

  async function cancelRegionQueue({ clearStatus = true }: { clearStatus?: boolean } = {}): Promise<void> {
    const queue = regionQueueRef.current;
    regionQueueRef.current = null;
    if (queue) await queue.cancel();
    useUiStore.getState().setQueue({
      searching: false,
      status: clearStatus ? ONLINE_QUEUE_IDLE_STATUS : undefined,
      canCancel: false,
    });
  }

  // ---------- HOST FLOW (port of main.js startHosting, 117-415) ----------
  function startHosting(name: string, options: HostStartOptions = {}): void {
    useSessionStore.getState().startSession("host");
    resetSnapshotRef();
    useUiStore.getState().setMenuStatus("Creating room…");
    clearMatchmakingHostTimeout();

    const sim = new Simulation({
      mobsEnabled: options.practice ? false : options.mobsEnabled,
      arenaWorld: options.arenaWorld,
      landSize: options.landSize,
      enabledObstacles: options.enabledObstacles,
      draftEnabled: true,
      practiceMode: !!options.practice,
    });

    function humanPlayers(): number {
      return [...snapshotRef.meta.values()].filter((meta) => !meta.isBot).length;
    }

    function syncBotMeta(): void {
      for (const id of [...snapshotRef.meta.keys()]) {
        if (id.startsWith("bot:")) snapshotRef.meta.delete(id);
      }
      for (const p of sim.botPlayers()) {
        const character = CFG.CHARACTERS[p.colorIndex % CFG.CHARACTERS.length].id;
        snapshotRef.meta.set(p.id, { name: p.name, colorIndex: p.colorIndex, isBot: true, character, userId: null });
      }
    }

    function applyBotSettings(): void {
      if (options.matchmaking) {
        sim.setBotRoster(0, "smart");
        syncBotMeta();
        return;
      }
      const { count, skill } = getUiInputs().botSettings;
      sim.setBotRoster(count, skill);
      syncBotMeta();
    }

    function metaToArray() {
      return [...snapshotRef.meta.entries()].map(([id, m]) => ({
        id, name: m.name, colorIndex: m.colorIndex, isBot: !!m.isBot,
        character: m.character || CFG.DEFAULT_CHARACTER, userId: m.userId || null,
      }));
    }

    function pushLobby(): void {
      const players = metaToArray();
      const config = {
        arenaWorld: sim.world.id,
        landSize: sim.landSize.id,
        enabledObstacles: sim.enabledObstacles,
        mobsEnabled: sim.mobsEnabled,
      };
      host.broadcast({ type: MSG.LOBBY, players, hostId: localIdRef.current, config });
      // player list / start-button enablement: already driven reactively —
      // LobbyRoot.tsx computes playerCount from useRosterStore (kept in sync
      // every host-loop tick via onNewSnapshot, including during LOBBY
      // phase) and disables Start Brawl itself when playerCount < 2.
    }

    function beginMatch(): boolean {
      if (!sim.startMatch()) {
        useUiStore.getState().setLobbyStatus("Need at least 2 warlocks to start.");
        return false;
      }
      clearMatchmakingHostTimeout();
      host.broadcast({ type: MSG.START, round: sim.round });
      lastRosterRef.current = host.emitRoster();
      ensureVoice().updateRoster(lastRosterRef.current);
      useSessionStore.getState().setInGame(true);
      useSessionStore.getState().setScreen("game");
      return true;
    }

    function armMatchmakingHostTimeout(): void {
      if (!options.matchmaking) return;
      clearMatchmakingHostTimeout();
      const timeoutHost = host;
      matchmakingHostTimeoutRef.current = setTimeout(() => {
        if (engines.host !== timeoutHost || sim.phase !== PHASE.LOBBY || humanPlayers() >= 2) return;
        options.onMatchmakingTimeout?.();
      }, CFG.MATCHMAKING.OFFER_TIMEOUT_MS);
    }

    function handleHostError(err: unknown): void {
      clearMatchmakingHostTimeout();
      if (options.matchmaking && options.onHostError) {
        options.onHostError(err);
        return;
      }
      const e = err as { type?: string; message?: string };
      useUiStore.getState().setMenuStatus("Host error: " + (e?.type || e?.message || String(err)));
    }

    const host = new Host({
      name,
      matchmaking: options.matchmaking
        ? { matchId: options.matchmaking.matchId, allowedQueueIds: options.matchmaking.allowedQueueIds }
        : null,
      onReady: ({ code, localId: hid }) => {
        localIdRef.current = hid;
        setLocalId(hid);
        const p: Player = sim.addPlayer(hid, name);
        snapshotRef.meta.set(hid, {
          name,
          colorIndex: p.colorIndex,
          character: options.character || CFG.DEFAULT_CHARACTER,
          userId: getUser()?.id || null,
        });
        // showGame()/showLobby()/maybeShowConduct() are dropped throughout
        // this function — each is already paired with the useSessionStore
        // write right beside it (screen drives <UiRoot>'s screen switch);
        // maybeShowConduct's one-time disclaimer is now owned by
        // PauseMenu.tsx, which auto-shows ConductModal on first "game" entry
        // (see that file's header).
        if (options.practice) {
          if (sim.startMatch()) {
            host.broadcast({ type: MSG.START, round: sim.round });
            useSessionStore.getState().setInGame(true);
            useSessionStore.getState().setScreen("game");
          } else {
            pushLobby();
            useSessionStore.getState().setScreen("lobby");
          }
        } else {
          pushLobby();
          useSessionStore.getState().setScreen("lobby");
          const hostReady = options.onHostReady?.(code);
          if (options.matchmaking) {
            Promise.resolve(hostReady)
              .then((sent) => { if (sent !== false) armMatchmakingHostTimeout(); })
              .catch((err) => handleHostError(err));
          }
        }
        useSessionStore.getState().setRoom(code, true);
      },
      onPlayerJoin: (peerId, pname, character, extraMeta) => {
        const p = sim.addPlayer(peerId, pname);
        snapshotRef.meta.set(peerId, {
          name: pname,
          colorIndex: p.colorIndex,
          character: getCharacter(character ?? undefined).id,
          userId: extraMeta?.userId || null,
        });
        if (sim.phase === PHASE.LOBBY) applyBotSettings();
        pushLobby();
        lastRosterRef.current = host.emitRoster();
        voiceRef.current?.updateRoster(lastRosterRef.current);
        if (sim.phase !== PHASE.LOBBY) {
          const welcomeSnap = sim.snapshot({ trackSend: false });
          host.sendTo(peerId, { type: MSG.STATE, ...welcomeSnap, mapLayout: sim.mapLayout });
        }
        useUiStore.getState().setLobbyStatus(`${pname} joined.`);
        getAudio().play("playerJoin");
        if (options.matchmaking && sim.phase === PHASE.LOBBY && humanPlayers() >= 2) {
          clearMatchmakingHostTimeout();
          useUiStore.getState().setLobbyStatus("Opponent connected. Starting match...");
          beginMatch();
        }
      },
      onPlayerLeave: (peerId) => {
        const m = snapshotRef.meta.get(peerId);
        sim.removePlayer(peerId);
        snapshotRef.meta.delete(peerId);
        pushLobby();
        lastRosterRef.current = host.emitRoster();
        voiceRef.current?.updateRoster(lastRosterRef.current);
        if (sim.phase === PHASE.LOBBY) {
          // sim.resolveRoundIfNeeded() can drop the match back to LOBBY
          // phase mid-game (e.g. a 2-player match where one player leaves) —
          // ui.showLobby() used to be the only thing that flipped the
          // visible screen back; nothing else derives `screen` from `phase`
          // reactively (see useSessionStore.ts's header), so this write must
          // stay even though the rest of this handler's ui.* calls don't.
          applyBotSettings();
          useSessionStore.getState().setInGame(false);
          useSessionStore.getState().setScreen("lobby");
        }
        if (m) useUiStore.getState().setLobbyStatus(`${m.name} left.`);
        getAudio().play("playerLeave");
      },
      onError: (err) => handleHostError(err),
    });

    host.onInput((peerId, msg) => sim.setInput(peerId, msg));
    host.onDraft((peerId, msg) => sim.applyDraft(peerId, msg));
    host.onChat((fromId, msg) => {
      const relay = { type: MSG.CHAT, fromId, text: msg.text, kind: msg.kind, t: Date.now() };
      host.broadcast(relay);
      applyChat(relay);
      getAudio().play("chatMessage");
    });
    host.onTyping((fromId, v) => { const p = sim.players.get(fromId); if (p) p.typingUntil = v ? Date.now() + CFG.SOCIAL.TYPING_TTL_MS : 0; });
    host.onAfk((fromId, v) => { const p = sim.players.get(fromId); if (p) p.afk = v; });
    host.onSpeak((fromId, v) => { const p = sim.players.get(fromId); if (p) p.speaking = v; });

    socialSendRef.current = {
      chat(text) {
        const relay = host.localChat(text);
        if (relay) { host.broadcast(relay); applyChat(relay); }
      },
      typing(v) { const p = sim.players.get(localIdRef.current!); if (p) p.typingUntil = v ? Date.now() + CFG.SOCIAL.TYPING_TTL_MS : 0; },
      afk(v) { const p = sim.players.get(localIdRef.current!); if (p) p.afk = !!v; },
      speak(v) { const p = sim.players.get(localIdRef.current!); if (p) p.speaking = !!v; },
    };

    hostApplyBotSettingsRef.current = applyBotSettings;
    hostPushLobbyRef.current = pushLobby;
    hostBeginMatchRef.current = beginMatch;
    sessionSimRef.current = sim;

    hostRef.current = host;
    clientRef.current = null;
    setEngines({ role: "host", host, client: null, sim });
  }

  // ---------- CLIENT FLOW (port of main.js startJoining, 418-531) ----------
  function startJoining(name: string, code: string, character?: string | null, extra: { userId?: string | null; region?: string | null; matchmaking?: { matchId: string; queueId: string } } = {}): void {
    useSessionStore.getState().startSession("client");
    resetSnapshotRef();
    useUiStore.getState().setMenuStatus("Connecting to room " + code + "…");

    const client = new Client({
      name, code, character,
      userId: extra.userId || getUser()?.id || null,
      region: extra.region || currentRegionRef.current,
      matchmaking: extra.matchmaking,
      onWelcome: () => {
        localIdRef.current = client.localId;
        setLocalId(client.localId);
        snapshotRef.meta.set(client.localId!, {
          name, colorIndex: 0, character: getCharacter(character ?? undefined).id,
          userId: extra.userId || getUser()?.id || null,
        });
        useUiStore.getState().setLobbyStatus("Connected! Waiting for host to start…");
        useSessionStore.getState().setRoom(code, false);
        useSessionStore.getState().setScreen("lobby");
      },
      onLobby: (msg) => {
        snapshotRef.meta.clear();
        for (const p of msg.players) {
          snapshotRef.meta.set(p.id, {
            name: p.name, colorIndex: p.colorIndex, isBot: !!p.isBot,
            character: p.character || CFG.DEFAULT_CHARACTER, userId: p.userId || null,
          });
        }
        // player list: reactive via useRosterStore, same as the host side
        // (see startHosting's pushLobby comment). msg.config (the host's
        // chosen arena/land/mobs settings) has NO store home yet — a joined
        // client's MatchSetupPanel/BattlegroundHero read their OWN local
        // useLobbyConfigStore, not the host's broadcast. This is a
        // pre-existing P5 gap (MatchSetupPanel.tsx's own header already
        // documents it as a deferred follow-up, predating this PR), not one
        // P6 introduces — flagged again here so it isn't lost now that the
        // legacy ui.renderLobbyConfig() DOM fallback is gone too.
      },
      onStart: () => {
        ensureVoice();
        useSessionStore.getState().setInGame(true);
        useSessionStore.getState().setScreen("game");
      },
      onState: (snap: Snapshot) => {
        if (snapshotRef.current && snap.t <= snapshotRef.current.t) return;
        if (!useSessionStore.getState().inGame && snap.phase !== PHASE.LOBBY) {
          ensureVoice();
          useSessionStore.getState().setScreen("game");
          useSessionStore.getState().setInGame(true);
        }
        onNewSnapshot(snap, localIdRef.current);
      },
      onChat: (msg) => { applyChat(msg); getAudio().play("chatMessage"); },
      onRoster: (msg) => { lastRosterRef.current = msg.peers || []; voiceRef.current?.updateRoster(lastRosterRef.current); },
      onError: (err) => {
        const t = err?.type || "";
        if (t === "peer-unavailable") useUiStore.getState().setMenuStatus("Room not found. Check the code.");
        else if (t === "room-full") useUiStore.getState().setMenuStatus("Room is full.");
        else if (t === "matchmaking-rejected") useUiStore.getState().setMenuStatus("Matchmaking join rejected. Search again.");
        else useUiStore.getState().setMenuStatus("Connection error: " + (t || err?.message || err));
        teardown();
      },
      onClose: () => {
        teardown();
        useUiStore.getState().setMenuStatus("Disconnected from host.");
      },
    });

    socialSendRef.current = {
      chat(text) { client.sendChat(text); },
      typing(v) { client.sendTyping(v); },
      afk(v) { client.sendAfk(v); },
      speak(v) { client.sendSpeak(v); },
    };

    hostRef.current = null;
    clientRef.current = client;
    setEngines({ role: "client", host: null, client, sim: null });
  }

  // Refs used to forward draft/dummy/bot/config intents to the CURRENT
  // session's host-local closures above without re-deriving them.
  const hostApplyBotSettingsRef = useRef<(() => void) | null>(null);
  const hostPushLobbyRef = useRef<(() => void) | null>(null);
  const hostBeginMatchRef = useRef<(() => boolean) | null>(null);
  const sessionSimRef = useRef<Simulation | null>(null);

  // ---------- Online room teardown (host-side, main.js 534-559) ----------
  async function teardownOnlineRoom(snap: Snapshot): Promise<void> {
    if (!isEnabled()) return;
    try {
      await submitMatchResult({
        region: onlineRef.current.region || CFG.DEFAULT_REGION || "sea",
        map: snap.arenaWorld || CFG.DEFAULT_ARENA_WORLD,
        roundCount: snap.round || 0,
        players: snap.players.map((p) => {
          const meta = snapshotRef.meta.get(p.id) || ({} as PlayerMeta);
          return {
            userId: meta.userId || null,
            username: meta.name || "warlock",
            kills: p.k ?? 0,
            deaths: p.d ?? 0,
            roundWins: p.s ?? 0,
            won: snap.matchWinner === p.id,
          };
        }),
      });
    } catch { /* non-fatal */ }
  }

  // Full teardown, shared by leaveMatch and involuntary disconnects — mirrors
  // main.js resetMatchState() (806-832). Bumping sessionGen (via
  // useSessionStore.endSession()) stops the running useHostLoop/useClientLoop
  // rAF; this function does the rest (imperative peer/voice teardown).
  function teardown(): void {
    clearMatchmakingHostTimeout();
    // hidePause()/closeChat() are dropped, not replaced — PauseMenu.tsx's own
    // "defensive reset" effect (keyed on `screen !== "game"`) already resets
    // useUiStore.paused/chatOpen to false on every path back to the menu,
    // explicitly documented as mirroring this exact pair of legacy calls
    // (see that file's comment right above the effect). endSession() below
    // sets screen back to "menu", which fires that effect.
    const input = getInput();
    input.paused = false;
    input.chatting = false;
    try { hostRef.current?.destroy(); } catch { /* ignore */ }
    try { clientRef.current?.destroy(); } catch { /* ignore */ }
    try { voiceRef.current?.teardown(); } catch { /* ignore */ }
    hostRef.current = null;
    clientRef.current = null;
    voiceRef.current = null;
    socialSendRef.current = null;
    lastRosterRef.current = [];
    useChatStore.getState().clear(); // sole write since P6 (used to also dual-write ui.clearChatLog())
    resetSnapshotRef();
    onlineRef.current = { isOnline: false, region: null, matchResultSubmitted: false };
    localIdRef.current = null;
    sessionSimRef.current = null;
    setEngines({ role: null, host: null, client: null, sim: null });
    useSessionStore.getState().endSession();
  }

  // Match-end online submit (design §6.3 note: "stays in host session hook")
  // — polled from a light subscription rather than folded into onNewSnapshot
  // (which has no host-only knowledge of _isOnline/_matchResultSubmitted).
  useEffect(() => {
    if (engines.role !== "host" || !engines.sim) return;
    const id = setInterval(() => {
      const sim = engines.sim!;
      if (sim.phase !== PHASE.MATCH_END || !onlineRef.current.isOnline || onlineRef.current.matchResultSubmitted) return;
      onlineRef.current.matchResultSubmitted = true;
      void teardownOnlineRoom(sim.snapshot({ trackSend: false }));
    }, 250);
    return () => clearInterval(id);
  }, [engines.role, engines.sim]);

  useHostLoop(engines.host, engines.sim, getInput(), localIdRef);
  useClientLoop(engines.client, getInput());

  const intents: GameSessionIntents = {
    hostPrivate(name, options = {}) {
      void cancelRegionQueue();
      onlineRef.current.isOnline = false;
      onlineRef.current.matchResultSubmitted = false;
      startHosting(name, options);
    },
    join(name, code, character) {
      void cancelRegionQueue();
      onlineRef.current.isOnline = false;
      startJoining(name, code, character);
    },
    practice(name, options = {}) {
      startHosting(name, { ...options, practice: true });
    },
    quickMatch() {
      if (!isEnabled()) { useUiStore.getState().setMenuStatus("Online play requires a Supabase project."); return; }
      const name = getUiInputs().name;
      if (!name) { useUiStore.getState().setMenuStatus("Enter a name first."); return; }
      if (regionQueueRef.current) return;
      onlineRef.current = { isOnline: false, region: null, matchResultSubmitted: false };

      const regionQueue = new RegionQueue({
        homeRegion: currentRegionRef.current,
        player: { name, character: getUiInputs().character ?? undefined },
        regions: CFG.REGIONS,
        onStatus: (status) => {
          if (regionQueueRef.current !== regionQueue) return;
          useUiStore.getState().setQueue({
            searching: true,
            status,
            canCancel: status.startsWith("Searching ") || status.startsWith("Widening "),
          });
        },
        onHostElected: (match: Match) => {
          if (regionQueueRef.current !== regionQueue) return;
          onlineRef.current.isOnline = true;
          onlineRef.current.region = match.region;
          onlineRef.current.matchResultSubmitted = false;
          const { mobsEnabled, character, arenaSettings } = getUiInputs();
          startHosting(name, {
            mobsEnabled,
            character: character ?? undefined,
            ...arenaSettings,
            matchmaking: { matchId: match.matchId, allowedQueueIds: [match.guestQueueId] },
            onHostReady: async (code) => {
              if (regionQueueRef.current !== regionQueue) return false;
              const sent = await regionQueue.sendOffer(match, { code });
              if (!sent) {
                teardown();
                useUiStore.getState().setQueue({ searching: false, status: "Match offer failed. Search again.", canCancel: false });
                return false;
              }
              if (regionQueueRef.current === regionQueue) regionQueueRef.current = null;
              return true;
            },
            onHostError: async () => {
              if (regionQueueRef.current === regionQueue) await cancelRegionQueue({ clearStatus: false });
              teardown();
              useUiStore.getState().setQueue({ searching: false, status: "Quick Match host failed. Search again.", canCancel: false });
            },
            onMatchmakingTimeout: () => {
              teardown();
              useUiStore.getState().setQueue({ searching: false, status: "Opponent did not connect. Search again.", canCancel: false });
            },
          });
        },
        onOffer: async ({ match, code }: { match: Match; code: string }) => {
          if (regionQueueRef.current !== regionQueue) return;
          onlineRef.current.isOnline = true;
          onlineRef.current.region = match.region;
          onlineRef.current.matchResultSubmitted = false;
          await regionQueue.cancel();
          if (regionQueueRef.current === regionQueue) regionQueueRef.current = null;
          startJoining(name, code, getUiInputs().character, {
            region: match.region,
            matchmaking: { matchId: match.matchId, queueId: regionQueue.queueId },
          });
        },
        onError: () => {
          if (regionQueueRef.current !== regionQueue) return;
          regionQueueRef.current = null;
          useUiStore.getState().setQueue({ searching: false, status: "Quick Match unavailable. Try again.", canCancel: false });
        },
      });

      regionQueueRef.current = regionQueue;
      regionQueue.start();
    },
    async cancelQueue() {
      await cancelRegionQueue();
      useUiStore.getState().setMenuStatus("Matchmaking canceled.");
    },
    async leaveMatch() {
      await cancelRegionQueue();
      teardown(); // endSession() already returns screen to "menu"
    },
    resume() {
      const input = getInput();
      input.paused = false;
      socialSendRef.current?.afk(false);
      input.resetActivity();
    },
    draft(action) {
      if (engines.role === "host") sessionSimRef.current?.applyDraft(localIdRef.current!, action as never);
      else if (engines.role === "client") engines.client?.sendDraft(action);
    },
    spawnDummy(type) {
      if (sessionSimRef.current?.practiceMode) sessionSimRef.current.spawnDummyMob(type);
    },
    clearDummies() {
      if (sessionSimRef.current?.practiceMode) sessionSimRef.current.clearDummies();
    },
    changeLoadout(ids) {
      if (sessionSimRef.current?.practiceMode) sessionSimRef.current.changeLoadout(localIdRef.current!, ids);
    },
    toggleNoCooldown(on) {
      if (sessionSimRef.current?.practiceMode) sessionSimRef.current.setPracticeNoCooldown(on);
    },
    bots() {
      hostApplyBotSettingsRef.current?.();
      hostPushLobbyRef.current?.();
    },
    configChange() {
      const { arenaSettings, mobsEnabled } = getUiInputs();
      sessionSimRef.current?.configure({ ...arenaSettings, mobsEnabled });
      hostPushLobbyRef.current?.();
    },
    // Port of main.js's ui.on("start", () => { applyBotSettings(); beginMatch(); }).
    startMatch() {
      hostApplyBotSettingsRef.current?.();
      hostBeginMatchRef.current?.();
    },
    sendChat(text) { socialSendRef.current?.chat(text); },
    sendTyping(v) { socialSendRef.current?.typing(v); },
    sendAfk(v) { socialSendRef.current?.afk(v); },
    sendSpeak(v) { socialSendRef.current?.speak(v); },
    toggleMute(peerId) {
      const m = snapshotRef.meta.get(peerId);
      const muted = social.toggleMute(peerId, m?.userId || null);
      voiceRef.current?.setMuted(peerId, muted);
      // refreshRosterMute() dropped, not replaced — SocialSettingsModal.tsx
      // reads social.isMuted() live at render time (its own comment
      // documents this), so it re-renders correctly on its own re-render
      // after this call, no store write needed.
    },
    clearMutes(peerIds) {
      for (const id of peerIds) voiceRef.current?.setMuted(id, false);
    },
    socialPrefs(prefs) {
      if (prefs.masterVolume != null) voiceRef.current?.setMasterVolume(prefs.masterVolume);
      if (prefs.micEnabled && voiceRef.current && !voiceRef.current.isAvailable()) voiceRef.current.init();
      voiceRef.current?.updateRoster(lastRosterRef.current);
    },
  };

  // Wire input.onCast/onPtt/onAfkChange ONCE (input is a page-lifetime
  // singleton; the callbacks below always dispatch to the CURRENT session's
  // audio/voice/senders via refs, so they never need to be reassigned).
  useEffect(() => {
    const input = getInput();
    input.onCast = () => getAudio().resume();
    input.onPtt = (on) => {
      if (voiceRef.current?.isAvailable()) voiceRef.current.setTransmitting(on);
      else socialSendRef.current?.speak(on);
    };
    input.onAfkChange = (idle) => socialSendRef.current?.afk(idle);
  }, []);

  useEffect(() => {
    gameSessionRef.current = intents;
    return () => { gameSessionRef.current = null; };
  });

  return intents;
}

// Not a hook (no hook calls inside) — just named for what it reads. Mirrors
// useSettingsStore's synchronous localStorage read for the region override
// (region.ts's own getRegion() is async, so it can't seed a ref at mount).
function readInitialRegion(): string {
  try {
    return localStorage.getItem("vwb-region") || CFG.DEFAULT_REGION;
  } catch {
    return CFG.DEFAULT_REGION;
  }
}
