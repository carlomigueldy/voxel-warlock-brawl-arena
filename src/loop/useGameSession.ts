// The session hook — ports main.js's startHosting/startJoining/matchmaking/
// social wiring (design §6.5) into a React hook that mounts useHostLoop XOR
// useClientLoop. Host/Client/Simulation/voice are per-match; the imperative
// legacy engines (renderer/ui/audio/input) are page-lifetime singletons from
// src/services/registry.ts (design §10 risk 2).
//
// Non-React code (wireLegacyUiToStores, driven by ui.js's DOM event
// handlers) needs to call these intents too, so — like snapshotRef/
// aimBridge/registry — the intents object is ALSO published to a
// module-level ref (`gameSessionRef`) on mount. <GameSession/> is the only
// component that ever calls this hook, so there is exactly one writer.
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
import { getUI, getAudio, getInput, getRenderer } from "../services/registry";
import { snapshotRef, setLocalId, resetSnapshotRef } from "../store/snapshotRef";
import { useSessionStore } from "../store/useSessionStore";
import { useUiStore } from "../store/useUiStore";
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
    const ui = getUI();
    const meta = snapshotRef.meta.get(relay.fromId);
    const color = CFG.COLORS[(meta?.colorIndex ?? 0) % CFG.COLORS.length];
    ui.addChatLine(meta?.name || "warlock", relay.text, color, relay.fromId === localIdRef.current);
    if (ui.getSocialPrefs().showBubbles) getRendererMaybe()?.showChatBubble(relay.fromId, relay.text, color);
  };

  // LegacyRendererBridge constructs the renderer; chat bubbles are a
  // renderer-only nicety, so no-op (not throw) if it hasn't mounted yet
  // (e.g. renderer=r3f, P4) or the registry hasn't been touched at all.
  function getRendererMaybe() {
    try {
      return getRenderer();
    } catch {
      return null;
    }
  }

  function ensureVoice(): VoiceChat {
    if (voiceRef.current) return voiceRef.current;
    const ui = getUI();
    const voice = new VoiceChat({
      getPeer: () => (hostRef.current?.peer || clientRef.current?.peer) || null,
      getRoster: () => lastRosterRef.current,
      isMuted: isPeerMuted,
      onSpeakingChange: (on) => socialSendRef.current?.speak(on),
      getPrefs: () => ui.getSocialPrefs(),
    });
    voiceRef.current = voice;
    if (ui.getSocialPrefs().micEnabled) voice.init();
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
    const ui = getUI();
    ui.setMenuStatus("Creating room…");
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
      const { count, skill } = ui.getBotSettings();
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
      ui.renderPlayerList(players, localIdRef.current);
      const btnStart = ui.el.btnStart as HTMLButtonElement | null;
      btnStart?.classList.toggle("hidden", !!options.matchmaking);
      if (btnStart) btnStart.disabled = !!options.matchmaking || !sim.canStartMatch();
    }

    function beginMatch(): boolean {
      if (!sim.startMatch()) {
        ui.setLobbyStatus("Need at least 2 warlocks to start.");
        return false;
      }
      clearMatchmakingHostTimeout();
      host.broadcast({ type: MSG.START, round: sim.round });
      lastRosterRef.current = host.emitRoster();
      ensureVoice().updateRoster(lastRosterRef.current);
      ui.showGame();
      ui.maybeShowConduct();
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
      ui.setMenuStatus("Host error: " + (e?.type || e?.message || String(err)));
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
        if (options.practice) {
          if (sim.startMatch()) {
            host.broadcast({ type: MSG.START, round: sim.round });
            ui.showGame(true);
            useSessionStore.getState().setInGame(true);
            useSessionStore.getState().setScreen("game");
          } else {
            ui.showLobby(code, { isHost: true });
            ui.maybeShowConduct();
            pushLobby();
            useSessionStore.getState().setScreen("lobby");
          }
        } else {
          ui.showLobby(code, { isHost: true });
          ui.maybeShowConduct();
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
        ui.setLobbyStatus(`${pname} joined.`);
        getAudio().play("playerJoin");
        if (options.matchmaking && sim.phase === PHASE.LOBBY && humanPlayers() >= 2) {
          clearMatchmakingHostTimeout();
          ui.setLobbyStatus("Opponent connected. Starting match...");
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
          applyBotSettings();
          ui.showLobby(host.code, { isHost: true });
          useSessionStore.getState().setInGame(false);
        }
        if (m) ui.setLobbyStatus(`${m.name} left.`);
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
    const ui = getUI();
    ui.setMenuStatus("Connecting to room " + code + "…");

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
        ui.showLobby(code, { isHost: false });
        ui.maybeShowConduct();
        ui.setLobbyStatus("Connected! Waiting for host to start…");
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
        ui.renderPlayerList(msg.players, msg.hostId);
        if (msg.config) ui.renderLobbyConfig(msg.config, { isHost: false });
      },
      onStart: () => {
        ensureVoice();
        ui.showGame();
        ui.maybeShowConduct();
        useSessionStore.getState().setInGame(true);
        useSessionStore.getState().setScreen("game");
      },
      onState: (snap: Snapshot) => {
        if (snapshotRef.current && snap.t <= snapshotRef.current.t) return;
        if (!useSessionStore.getState().inGame && snap.phase !== PHASE.LOBBY) {
          ensureVoice();
          ui.showGame();
          ui.maybeShowConduct();
          useSessionStore.getState().setScreen("game");
          useSessionStore.getState().setInGame(true);
        }
        onNewSnapshot(snap, localIdRef.current);
      },
      onChat: (msg) => { applyChat(msg); getAudio().play("chatMessage"); },
      onRoster: (msg) => { lastRosterRef.current = msg.peers || []; voiceRef.current?.updateRoster(lastRosterRef.current); },
      onError: (err) => {
        const t = err?.type || "";
        if (t === "peer-unavailable") ui.setMenuStatus("Room not found. Check the code.");
        else if (t === "room-full") ui.setMenuStatus("Room is full.");
        else if (t === "matchmaking-rejected") ui.setMenuStatus("Matchmaking join rejected. Search again.");
        else ui.setMenuStatus("Connection error: " + (t || err?.message || err));
        teardown();
        ui.showMenu();
      },
      onClose: () => {
        teardown();
        ui.setMenuStatus("Disconnected from host.");
        ui.showMenu();
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
    const ui = getUI();
    ui.hidePause();
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
    ui.closeChat();
    ui.clearChatLog();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (!isEnabled()) { getUI().setMenuStatus("Online play requires a Supabase project."); return; }
      const ui = getUI();
      const name = ui.getName();
      if (!name) { ui.setMenuStatus("Enter a name first."); return; }
      if (regionQueueRef.current) return;
      onlineRef.current = { isOnline: false, region: null, matchResultSubmitted: false };

      const regionQueue = new RegionQueue({
        homeRegion: currentRegionRef.current,
        player: { name, character: ui.getCharacter() ?? undefined },
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
          startHosting(name, {
            mobsEnabled: ui.mobsEnabled(),
            character: ui.getCharacter() ?? undefined,
            ...ui.getArenaSettings(),
            matchmaking: { matchId: match.matchId, allowedQueueIds: [match.guestQueueId] },
            onHostReady: async (code) => {
              if (regionQueueRef.current !== regionQueue) return false;
              const sent = await regionQueue.sendOffer(match, { code });
              if (!sent) {
                teardown();
                ui.showMenu();
                useUiStore.getState().setQueue({ searching: false, status: "Match offer failed. Search again.", canCancel: false });
                return false;
              }
              if (regionQueueRef.current === regionQueue) regionQueueRef.current = null;
              return true;
            },
            onHostError: async () => {
              if (regionQueueRef.current === regionQueue) await cancelRegionQueue({ clearStatus: false });
              teardown();
              ui.showMenu();
              useUiStore.getState().setQueue({ searching: false, status: "Quick Match host failed. Search again.", canCancel: false });
            },
            onMatchmakingTimeout: () => {
              teardown();
              ui.showMenu();
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
          startJoining(name, code, ui.getCharacter(), {
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
      getUI().setMenuStatus("Matchmaking canceled.");
    },
    async leaveMatch() {
      await cancelRegionQueue();
      teardown();
      getUI().showMenu();
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
      const ui = getUI();
      sessionSimRef.current?.configure({ ...ui.getArenaSettings(), mobsEnabled: ui.mobsEnabled() });
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
      getUI().refreshRosterMute(peerId, muted);
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
