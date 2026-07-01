// Entry point: wires UI + networking + simulation + renderer + online services.
import { CFG, MSG, getCharacter } from "./config.js";
import { Simulation, PHASE } from "./sim.js";
import { GameRenderer } from "./renderer.js";
import { InputController, setPttKey } from "./input.js";
import { Host, Client } from "./net.js";
import { UI } from "./ui.js";
import { AudioEngine } from "./audio.js";
import { CharacterPreview } from "./preview.js";
import { preloadAssets } from "./loader.js";
import { perf } from "./perf.js";
import { VoiceChat } from "./voice.js";
import * as social from "./social.js";

// Online services — all modules no-op gracefully when Supabase is not configured.
import { isEnabled } from "./supabase.js";
import { initAuth, getUser, onAuthChange, signUpEmail, signInEmail, signInWithEthereum, signInWithSolana, signInAsGuest, upgradeGuest, signOut } from "./auth.js";
import { getRegion, setRegion } from "./region.js";
import { RegionQueue } from "./matchmaking.js";
import { submitMatchResult, fetchLeaderboard } from "./leaderboard.js";

const ui = new UI();
const renderer = new GameRenderer(document.getElementById("game-canvas"));
const input = new InputController(renderer);
const audio = new AudioEngine();
renderer.setAudio(audio);
ui.setAudio(audio);
ui.setSpellSlotHotkeys(input.spellSlotHotkeys);
ui.setItemSlotHotkeys(input.itemSlotHotkeys);

// Dev FPS/stats overlay — OFF by default; enable with ?stats=1 or F3.
perf.init();

// Live 360° character preview — wired up immediately so it warms up behind
// the loader screen. preview.start() is also called in ui.showMenu() but it
// has an idempotent guard, so double-calling is safe.
const charPreviewCanvas = document.getElementById("char-preview");
if (charPreviewCanvas) {
  const preview = new CharacterPreview(charPreviewCanvas);
  ui.setPreview(preview);
  preview.start();
}

// Audio resumes on any interaction during gameplay (for mobile Safari etc.).
input.onCast = () => audio.resume();

// Metadata about every player (id -> {name, colorIndex, character, userId?}) for
// labels/scoreboard, kept in sync on both host and clients.
const playerMeta = new Map();

let role            = null;   // "host" | "client"
let host            = null;
let client          = null;
let localId         = null;
let latestSnapshot  = null;
let inGame          = false;
let sessionGen      = 0;       // bumped on leave/disconnect to stop stale rAF loops

// --- Social/voice state ---
let voice           = null;   // VoiceChat instance, created lazily on match start
let lastRoster      = [];     // most recent ROSTER peer list (real peers only)
// Per-role social senders, set once role/host/client are established; chat/typing/
// afk/speak all route through these so callers never branch on host vs client.
let socialSend      = null;   // { chat(text), typing(v), afk(v), speak(v) }

// Resolves local mute for a remote using both peerId and userId (see social.js).
function isPeerMuted(peerId) {
  const m = playerMeta.get(peerId);
  return social.isMuted(peerId, m?.userId || null);
}

// Applies a chat relay {fromId,text,kind,t} to the local log + world-space
// bubble. Shared by the host's own relay path and every client's onChat.
function applyChat(relay) {
  if (isPeerMuted(relay.fromId)) return; // local mute suppresses log + bubble
  const meta = playerMeta.get(relay.fromId);
  const color = CFG.COLORS[(meta?.colorIndex ?? 0) % CFG.COLORS.length];
  ui.addChatLine(meta?.name || "warlock", relay.text, color, relay.fromId === localId);
  if (ui.getSocialPrefs().showBubbles) renderer.showChatBubble(relay.fromId, relay.text, color);
}

// Uniform social senders — main.js callers never branch on role.
function sendChat(text)  { socialSend?.chat(text); }
function sendTyping(v)   { socialSend?.typing(v); }
function sendAfk(v)      { socialSend?.afk(v); }
function sendSpeak(v)    { socialSend?.speak(v); }

// Lazily constructs the voice mesh once per match (idempotent). Mic capture is
// opt-in: only actually requested if the player has enabled it in settings.
function ensureVoice() {
  if (voice) return voice;
  voice = new VoiceChat({
    getPeer: () => (host?.peer || client?.peer) || null,
    getRoster: () => lastRoster,
    isMuted: isPeerMuted,
    onSpeakingChange: (on) => sendSpeak(on),
    getPrefs: () => ui.getSocialPrefs(),
  });
  if (ui.getSocialPrefs().micEnabled) voice.init();
  // Seed the mesh immediately so a ROSTER that arrived before voice existed
  // (e.g. a mid-match joiner's onPlayerJoin roster racing ensureVoice) isn't
  // silently dropped — updateRoster() itself gates mesh formation on opt-in.
  voice.updateRoster(lastRoster);
  return voice;
}

// --- Online state ---
let _isOnline           = false;  // true when game was started via Online flow
let _onlineRegion       = null;   // region id for the current online session
let _currentRegion      = "sea";  // latest known region (from getRegion / regionChange)
let _matchResultSubmitted = false;
let _regionQueue        = null;
let _matchmakingHostTimeout = null;
const ONLINE_QUEUE_IDLE_STATUS = "Search your home region first. We widen the queue automatically.";

// ---------- HOST FLOW ----------
function startHosting(name, options = {}) {
  role = "host";
  ui.setMenuStatus("Creating room…");
  clearMatchmakingHostTimeout();

  const sim = new Simulation({
    // Practice mode spawns zero mobs automatically (dummies are spawned
    // on-demand via the practice panel — see spawnDummy() below).
    mobsEnabled: options.practice ? false : options.mobsEnabled,
    arenaWorld: options.arenaWorld,
    landSize: options.landSize,
    enabledObstacles: options.enabledObstacles,
    // Spell draft is always-on, including practice mode, so the player can
    // freely pick any loadout from the full spell list before testing it.
    draftEnabled: true,
    // Fixed arena, invulnerable player, no death-driven round end — see sim.js.
    practiceMode: !!options.practice,
  });

  host = new Host({
    name,
    matchmaking: options.matchmaking
      ? {
          matchId: options.matchmaking.matchId,
          allowedQueueIds: options.matchmaking.allowedQueueIds,
        }
      : null,
    onReady: ({ code, localId: hid }) => {
      localId = hid;
      renderer.setLocalId(localId);
      const p = sim.addPlayer(localId, name);
      playerMeta.set(localId, {
        name,
        colorIndex: p.colorIndex,
        character: options.character || CFG.DEFAULT_CHARACTER,
        userId: getUser()?.id || null,
      });
      if (options.practice) {
        // Practice mode: no auto-spawned hostiles — the arena starts empty
        // and the lobby is skipped straight to the game (spell draft, then
        // dummies spawned on demand via the practice panel).
        if (sim.startMatch()) {
          host.broadcast({ type: MSG.START, round: sim.round });
          ui.showGame(true);
          inGame = true;
        } else {
          // Fallback: show the lobby so practice never dead-ends.
          ui.showLobby(code, { isHost: true });
          ui.maybeShowConduct();
          pushLobby();
        }
      } else {
        ui.showLobby(code, { isHost: true });
        ui.maybeShowConduct();
        pushLobby();
        const hostReady = options.onHostReady?.(code);
        if (options.matchmaking) {
          Promise.resolve(hostReady)
            .then((sent) => {
              if (sent !== false) armMatchmakingHostTimeout();
            })
            .catch((err) => handleHostError(err));
        }
      }
    },
    onPlayerJoin: (peerId, pname, character, extraMeta) => {
      const p = sim.addPlayer(peerId, pname);
      playerMeta.set(peerId, {
        name: pname,
        colorIndex: p.colorIndex,
        character: getCharacter(character).id,
        userId: extraMeta?.userId || null,
      });
      if (sim.phase === PHASE.LOBBY) applyBotSettings();
      pushLobby();
      lastRoster = host.emitRoster();
      voice?.updateRoster(lastRoster);
      if (sim.phase !== PHASE.LOBBY) {
        const welcomeSnap = sim.snapshot({ trackSend: false });
        host.sendTo(peerId, { type: MSG.STATE, ...welcomeSnap, mapLayout: sim.mapLayout });
      }
      ui.setLobbyStatus(`${pname} joined.`);
      if (options.matchmaking && sim.phase === PHASE.LOBBY && humanPlayers() >= 2) {
        clearMatchmakingHostTimeout();
        ui.setLobbyStatus("Opponent connected. Starting match...");
        beginMatch();
      }
    },
    onPlayerLeave: (peerId) => {
      const m = playerMeta.get(peerId);
      sim.removePlayer(peerId);
      playerMeta.delete(peerId);
      pushLobby();
      lastRoster = host.emitRoster();
      voice?.updateRoster(lastRoster);
      if (sim.phase === PHASE.LOBBY) {
        applyBotSettings();
        ui.showLobby(host.code, { isHost: true });
        inGame = false;
      }
      if (m) ui.setLobbyStatus(`${m.name} left.`);
    },
    onError: (err) => handleHostError(err),
  });

  host.onInput((peerId, msg) => sim.setInput(peerId, msg));
  host.onDraft((peerId, msg) => sim.applyDraft(peerId, msg));

  // Social relay: net.js already sanitizes/rate-limits/stamps fromId for CHAT
  // and normalizes TYPING/AFK/SPEAK to booleans before these fire.
  host.onChat((fromId, msg) => {
    const relay = { type: MSG.CHAT, fromId, text: msg.text, kind: msg.kind, t: Date.now() };
    host.broadcast(relay);   // reaches every client incl. the sender (echo/confirm)
    applyChat(relay);        // host's own display
  });
  host.onTyping((fromId, v) => { const p = sim.players.get(fromId); if (p) p.typingUntil = v ? Date.now() + CFG.SOCIAL.TYPING_TTL_MS : 0; });
  host.onAfk((fromId, v)    => { const p = sim.players.get(fromId); if (p) p.afk = v; });
  host.onSpeak((fromId, v)  => { const p = sim.players.get(fromId); if (p) p.speaking = v; });

  // Host is a player too: its own social actions bypass the wire entirely.
  socialSend = {
    chat(text) {
      const relay = host.localChat(text);
      if (relay) { host.broadcast(relay); applyChat(relay); }
    },
    typing(v) { const p = sim.players.get(localId); if (p) p.typingUntil = v ? Date.now() + CFG.SOCIAL.TYPING_TTL_MS : 0; },
    afk(v)    { const p = sim.players.get(localId); if (p) p.afk = !!v; },
    speak(v)  { const p = sim.players.get(localId); if (p) p.speaking = !!v; },
  };

  // Host handles draft picks from its own UI locally; clients send them over the wire.
  ui.on("draft", (action) => {
    sim.applyDraft(localId, action);
  });

  // Practice-mode dummy panel — host-local only (practice is always solo, no
  // remote peers), so it talks to the sim directly rather than over the wire.
  ui.on("spawnDummy", (type) => {
    if (sim.practiceMode) sim.spawnDummyMob(type);
  });
  ui.on("clearDummies", () => {
    if (sim.practiceMode) sim.clearDummies();
  });
  ui.on("changeLoadout", (ids) => {
    if (sim.practiceMode) sim.changeLoadout(localId, ids);
  });
  ui.on("toggleNoCooldown", (on) => {
    if (sim.practiceMode) sim.setPracticeNoCooldown(on);
  });

  ui.on("bots", () => {
    applyBotSettings();
    pushLobby();
  });

  // Host-only lobby map/config controls (arena world, land size, map objects,
  // mob spawns) — relocated from the old "Settings" menu tab into the lobby.
  ui.on("configChange", () => {
    sim.configure({ ...ui.getArenaSettings(), mobsEnabled: ui.mobsEnabled() });
    pushLobby();
  });

  ui.on("start", () => {
    applyBotSettings();
    beginMatch();
  });

  function applyBotSettings() {
    if (options.matchmaking) {
      sim.setBotRoster(0, "smart");
      syncBotMeta();
      return;
    }
    const { count, skill } = ui.getBotSettings();
    sim.setBotRoster(count, skill);
    syncBotMeta();
  }

  function humanPlayers() {
    return [...playerMeta.values()].filter((meta) => !meta.isBot).length;
  }

  function beginMatch() {
    if (!sim.startMatch()) {
      ui.setLobbyStatus("Need at least 2 warlocks to start.");
      return false;
    }
    clearMatchmakingHostTimeout();
    host.broadcast({ type: MSG.START, round: sim.round });
    lastRoster = host.emitRoster();
    ensureVoice();
    voice.updateRoster(lastRoster);
    ui.showGame();
    ui.maybeShowConduct();
    inGame = true;
    return true;
  }

  function armMatchmakingHostTimeout() {
    if (!options.matchmaking) return;
    clearMatchmakingHostTimeout();
    const timeoutHost = host;
    _matchmakingHostTimeout = setTimeout(() => {
      if (host !== timeoutHost || role !== "host" || sim.phase !== PHASE.LOBBY || humanPlayers() >= 2) return;
      options.onMatchmakingTimeout?.();
    }, CFG.MATCHMAKING.OFFER_TIMEOUT_MS);
  }

  function handleHostError(err) {
    clearMatchmakingHostTimeout();
    if (options.matchmaking && options.onHostError) {
      options.onHostError(err);
      return;
    }
    ui.setMenuStatus("Host error: " + (err.type || err.message || err));
  }

  function syncBotMeta() {
    for (const id of [...playerMeta.keys()]) {
      if (id.startsWith("bot:")) playerMeta.delete(id);
    }
    for (const p of sim.botPlayers()) {
      const character = CFG.CHARACTERS[p.colorIndex % CFG.CHARACTERS.length].id;
      playerMeta.set(p.id, { name: p.name, colorIndex: p.colorIndex, isBot: true, character, userId: null });
    }
  }

  function pushLobby() {
    const players = metaToArray();
    const config = {
      arenaWorld: sim.world.id,
      landSize: sim.landSize.id,
      enabledObstacles: sim.enabledObstacles,
      mobsEnabled: sim.mobsEnabled,
    };
    host.broadcast({ type: MSG.LOBBY, players, hostId: localId, config });
    ui.renderPlayerList(players, localId);
    ui.el.btnStart.classList.toggle("hidden", !!options.matchmaking);
    ui.el.btnStart.disabled = !!options.matchmaking || !sim.canStartMatch();
  }

  // ---- Host authoritative loop ----
  const tickMs = 1000 / CFG.TICK_RATE;
  let acc = 0, last = performance.now();
  const mySession = ++sessionGen;
  function hostLoop(now) {
    // Bail immediately once superseded (leaveMatch/disconnect) so the already-
    // queued final frame never touches a torn-down host connection.
    if (sessionGen !== mySession) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (sim.phase === PHASE.PLAYING || sim.phase === PHASE.COUNTDOWN) {
      sim.setInput(localId, input.sample());
    }

    acc += dt;
    while (acc >= tickMs / 1000) {
      sim.step(tickMs / 1000);
      acc -= tickMs / 1000;
    }

    const snap = sim.snapshot();
    latestSnapshot = snap;
    host.broadcast({ type: MSG.STATE, ...snap });

    // Isolate rendering/UI from simulation & broadcast so a transient render
    // error doesn't silently swallow a persistent sim/network fault that would
    // otherwise desync clients (Hard rule: sim.step + host.broadcast stay
    // outside the guard so real faults still surface as loud crashes).
    try {
      renderer.apply(snap, playerMeta);
      if (snap.phase !== PHASE.LOBBY) {
        ui.updateHUD(snap, localId, playerMeta);
        ui.handleEvents(snap.events, snap.t);
        syncLocalSpellSlots(snap);
        ui.updateAbilityBar(snap, localId);
        ui.updateItemBar(snap, localId);
        playTransitionAudio(snap);

        // On match end: submit result + close the online room.
        if (snap.phase === PHASE.MATCH_END && _isOnline && !_matchResultSubmitted) {
          _matchResultSubmitted = true;
          _teardownOnlineRoom(snap);
        }
      }
      perf.begin();
      renderer.update();
      perf.end();
    } catch (err) {
      console.error("[hostLoop] frame error (continuing):", err);
    }
    if (sessionGen === mySession) requestAnimationFrame(hostLoop);
  }
  requestAnimationFrame(hostLoop);
}

// ---------- CLIENT FLOW ----------
function startJoining(name, code, character, { userId, region, matchmaking } = {}) {
  role = "client";
  ui.setMenuStatus("Connecting to room " + code + "…");

  client = new Client({
    name, code, character,
    // These extra fields are passed per the data team's net.js contract.
    userId: userId || getUser()?.id || null,
    region: region || _currentRegion,
    matchmaking,
    onWelcome: (msg) => {
      localId = client.localId;
      renderer.setLocalId(localId);
      playerMeta.set(localId, { name, colorIndex: 0, character: getCharacter(character).id, userId: userId || getUser()?.id || null });
      ui.showLobby(code, { isHost: false });
      ui.maybeShowConduct();
      ui.setLobbyStatus("Connected! Waiting for host to start…");
    },
    onLobby: (msg) => {
      playerMeta.clear();
      msg.players.forEach((p) => playerMeta.set(p.id, {
        name: p.name, colorIndex: p.colorIndex, isBot: !!p.isBot,
        character: p.character || CFG.DEFAULT_CHARACTER, userId: p.userId || null,
      }));
      ui.renderPlayerList(msg.players, msg.hostId);
      // Backward-tolerant: older hosts (or the very first LOBBY packet) may omit config.
      if (msg.config) ui.renderLobbyConfig(msg.config, { isHost: false });
    },
    onStart: () => {
      ensureVoice();
      ui.showGame();
      ui.maybeShowConduct();
      inGame = true;
    },
    onState: (snap) => {
      if (latestSnapshot && snap.t <= latestSnapshot.t) return;
      latestSnapshot = snap;
      if (!inGame && snap.phase !== PHASE.LOBBY) {
        ensureVoice();
        ui.showGame();
        ui.maybeShowConduct();
        inGame = true;
      }
    },
    onChat:   (msg) => applyChat(msg),                  // {fromId,text,kind,t}
    onRoster: (msg) => { lastRoster = msg.peers || []; voice?.updateRoster(lastRoster); },
    onError: (err) => {
      const t = err.type || "";
      if (t === "peer-unavailable") ui.setMenuStatus("Room not found. Check the code.");
      else if (t === "room-full") ui.setMenuStatus("Room is full.");
      else if (t === "matchmaking-rejected") ui.setMenuStatus("Matchmaking join rejected. Search again.");
      else ui.setMenuStatus("Connection error: " + (t || err.message || err));
      resetMatchState();
      ui.showMenu();
    },
    onClose: () => {
      resetMatchState();
      ui.setMenuStatus("Disconnected from host.");
      ui.showMenu();
    },
  });

  // Client-side draft: UI picks are sent over the existing data channel to the host.
  ui.on("draft", (action) => {
    client.sendDraft(action);
  });

  // Client social sends just forward over the wire; display happens only when
  // the host relay comes back via onChat, keeping ordering host-authoritative.
  socialSend = {
    chat(text)  { client.sendChat(text); },
    typing(v)   { client.sendTyping(v); },
    afk(v)      { client.sendAfk(v); },
    speak(v)    { client.sendSpeak(v); },
  };

  // ---- Client loop: send input, render last snapshot ----
  const inputMs = 1000 / CFG.INPUT_RATE;
  let lastInput = 0;
  const mySession = ++sessionGen;
  function clientLoop(now) {
    // Stop once superseded (leaveMatch/disconnect) before touching the client.
    if (sessionGen !== mySession) return;
    if (now - lastInput >= inputMs) {
      client.sendInput(input.sample());
      lastInput = now;
    }
    // Isolate rendering/UI from input-send so a transient render error doesn't
    // swallow a persistent network fault (client.sendInput stays outside the guard).
    try {
      if (latestSnapshot) {
        for (const p of latestSnapshot.players) {
          if (!playerMeta.has(p.id)) playerMeta.set(p.id, { name: "warlock", colorIndex: 0, userId: null });
        }
        renderer.apply(latestSnapshot, playerMeta);
        if (latestSnapshot.phase !== PHASE.LOBBY) {
          ui.updateHUD(latestSnapshot, localId, playerMeta);
          ui.handleEvents(latestSnapshot.events, latestSnapshot.t);
          syncLocalSpellSlots(latestSnapshot);
          ui.updateAbilityBar(latestSnapshot, localId);
          ui.updateItemBar(latestSnapshot, localId);
          playTransitionAudio(latestSnapshot);
        }
      }
      perf.begin();
      renderer.update();
      perf.end();
    } catch (err) {
      console.error("[clientLoop] frame error (continuing):", err);
    }
    if (sessionGen === mySession) requestAnimationFrame(clientLoop);
  }
  requestAnimationFrame(clientLoop);
}

// ---------- Online room teardown (host-side) ----------
async function _teardownOnlineRoom(snap) {
  if (!isEnabled()) return;
  try {
    const payload = _buildMatchPayload(snap);
    await submitMatchResult(payload);
  } catch { /* non-fatal */ }
}

function _buildMatchPayload(snap) {
  return {
    region:     _onlineRegion || CFG.DEFAULT_REGION || 'sea',
    map:        snap.arenaWorld || CFG.DEFAULT_ARENA_WORLD,
    roundCount: snap.round || 0,
    players: snap.players.map((p) => {
      const meta = playerMeta.get(p.id) || {};
      return {
        userId:    meta.userId  || null,
        username:  meta.name    || 'warlock',
        kills:     p.k          ?? 0,
        deaths:    p.d          ?? 0,
        roundWins: p.s          ?? 0,
        won:       snap.matchWinner === p.id,
      };
    }),
  };
}

async function cancelRegionQueue({ clearStatus = true } = {}) {
  const queue = _regionQueue;
  _regionQueue = null;
  if (queue) await queue.cancel();
  ui.setOnlineQueueState({ searching: false, status: clearStatus ? ONLINE_QUEUE_IDLE_STATUS : undefined, canCancel: false });
}

function clearMatchmakingHostTimeout() {
  if (!_matchmakingHostTimeout) return;
  clearTimeout(_matchmakingHostTimeout);
  _matchmakingHostTimeout = null;
}

// ---------- Audio transition cues ----------
let _lastPhase = null;
let _lastCount = null;
function playTransitionAudio(snap) {
  if (!snap) return;
  if (snap.phase === PHASE.COUNTDOWN) {
    const c = Math.ceil(snap.timer);
    if (c !== _lastCount && c > 0) { audio.play("countdown"); _lastCount = c; }
  } else if (_lastPhase === PHASE.COUNTDOWN && snap.phase === PHASE.PLAYING) {
    audio.play("go"); _lastCount = null;
  }
  if (snap.phase !== _lastPhase) {
    if (snap.phase === PHASE.ROUND_END) {
      audio.play(snap.winner === localId ? "win" : "lose");
    } else if (snap.phase === PHASE.MATCH_END) {
      audio.play(snap.matchWinner === localId ? "win" : "lose");
    }
    _lastPhase = snap.phase;
  }
}

function metaToArray() {
  return [...playerMeta.entries()].map(([id, m]) => ({
    id, name: m.name, colorIndex: m.colorIndex, isBot: !!m.isBot,
    character: m.character || CFG.DEFAULT_CHARACTER, userId: m.userId || null,
  }));
}

function syncLocalSpellSlots(snap) {
  const me = snap.players.find((p) => p.id === localId);
  if (me?.spellSlots) input.setSpellSlots(me.spellSlots);
  if (me?.items)      input.setItemSlots(me.items);
}

// ---------- UI event wiring ----------

// Private host — pure PeerJS, no matchmaking.
ui.on("hostPrivate", async (name, options) => {
  await cancelRegionQueue();
  _isOnline = false;
  _matchResultSubmitted = false;
  startHosting(name, options);
});

// Quick Match — queue into Supabase Realtime region channels.
ui.on("quickMatch", async () => {
  if (!isEnabled()) return ui.setMenuStatus("Online play requires a Supabase project.");
  const name = ui.getName();
  if (!name) return ui.setMenuStatus("Enter a name first.");
  if (_regionQueue) return;
  _isOnline = false;
  _onlineRegion = null;
  _matchResultSubmitted = false;

  const regionQueue = new RegionQueue({
    homeRegion: _currentRegion,
    player: {
      name,
      character: ui.getCharacter(),
    },
    regions: CFG.REGIONS,
    onStatus: (status) => {
      if (_regionQueue !== regionQueue) return;
      ui.setOnlineQueueState({
        searching: true,
        status,
        canCancel: status.startsWith("Searching ") || status.startsWith("Widening "),
      });
    },
    onHostElected: (match) => {
      if (_regionQueue !== regionQueue) return;
      _isOnline = true;
      _onlineRegion = match.region;
      _matchResultSubmitted = false;
      startHosting(name, {
        mobsEnabled: ui.mobsEnabled(),
        character: ui.getCharacter(),
        ...ui.getArenaSettings(),
        matchmaking: {
          matchId: match.matchId,
          allowedQueueIds: [match.guestQueueId],
        },
        onHostReady: async (code) => {
          if (_regionQueue !== regionQueue) return false;
          const sent = await regionQueue.sendOffer(match, { code });
          if (!sent) {
            resetMatchState();
            ui.showMenu();
            ui.setOnlineQueueState({ searching: false, status: "Match offer failed. Search again.", canCancel: false });
            return false;
          }
          if (_regionQueue === regionQueue) _regionQueue = null;
          return true;
        },
        onHostError: async () => {
          if (_regionQueue === regionQueue) await cancelRegionQueue({ clearStatus: false });
          resetMatchState();
          ui.showMenu();
          ui.setOnlineQueueState({ searching: false, status: "Quick Match host failed. Search again.", canCancel: false });
        },
        onMatchmakingTimeout: () => {
          resetMatchState();
          ui.showMenu();
          ui.setOnlineQueueState({ searching: false, status: "Opponent did not connect. Search again.", canCancel: false });
        },
      });
    },
    onOffer: async ({ match, code }) => {
      if (_regionQueue !== regionQueue) return;
      _isOnline = true;
      _onlineRegion = match.region;
      _matchResultSubmitted = false;
      await regionQueue.cancel();
      if (_regionQueue === regionQueue) _regionQueue = null;
      startJoining(name, code, ui.getCharacter(), {
        region: match.region,
        matchmaking: {
          matchId: match.matchId,
          queueId: regionQueue.queueId,
        },
      });
    },
    onError: () => {
      if (_regionQueue !== regionQueue) return;
      _regionQueue = null;
      ui.setOnlineQueueState({ searching: false, status: "Quick Match unavailable. Try again.", canCancel: false });
    },
  });

  _regionQueue = regionQueue;
  regionQueue.start();
});

ui.on("cancelQueue", async () => {
  await cancelRegionQueue();
  ui.setMenuStatus("Matchmaking canceled.");
});

// Private join by code — pure PeerJS, no matchmaking.
ui.on("joinByCode", async (name, code, character) => {
  await cancelRegionQueue();
  _isOnline = false;
  startJoining(name, code, character);
});

// Region change — persist and refresh room list.
ui.on("regionChange", async (id) => {
  _currentRegion = id;
  setRegion(id);
});

// Screen change — leaderboards refresh on demand.
ui.on("screenChange", async (name) => {
  if (name === "leaderboards" && isEnabled()) {
    fetchLeaderboard({ region: null, metric: "wins", limit: 20 })
      .then((rows) => ui.renderLeaderboard(rows || [], { metric: "wins", scope: "global" }))
      .catch(() => {});
  }
});

// Leaderboard metric / scope change.
ui.on("leaderboardChange", async ({ metric, scope }) => {
  if (!isEnabled()) return;
  try {
    const region = scope === "region" ? _currentRegion : null;
    const rows = await fetchLeaderboard({ region, metric, limit: 20 });
    ui.renderLeaderboard(rows || [], { metric, scope });
  } catch { /* non-fatal */ }
});

// Auth events.
ui.on("signUp", async ({ email, password, username }) => {
  try {
    await signUpEmail({ email, password, username });
    ui.renderAuthState(getUser());
  } catch (err) {
    ui.setMenuStatus("Sign up failed: " + (err.message || err));
  }
});

ui.on("signIn", async ({ email, password }) => {
  try {
    await signInEmail({ email, password });
    ui.renderAuthState(getUser());
  } catch (err) {
    ui.setMenuStatus("Sign in failed: " + (err.message || err));
  }
});

ui.on("ethSignIn", async () => {
  try {
    await signInWithEthereum();
    ui.renderAuthState(getUser());
  } catch (err) {
    ui.setMenuStatus("Ethereum sign-in failed: " + (err.message || err));
  }
});

ui.on("solSignIn", async () => {
  try {
    await signInWithSolana();
    ui.renderAuthState(getUser());
  } catch (err) {
    ui.setMenuStatus("Solana sign-in failed: " + (err.message || err));
  }
});

ui.on("guest", async () => {
  try {
    await signInAsGuest();
    ui.renderAuthState(getUser());
  } catch (err) {
    ui.setMenuStatus("Guest sign-in failed: " + (err.message || err));
  }
});

ui.on("upgrade", async ({ email, password, username }) => {
  try {
    await upgradeGuest({ email, password, username });
    ui.renderAuthState(getUser());
  } catch (err) {
    ui.setMenuStatus("Upgrade failed: " + (err.message || err));
  }
});

ui.on("signOut", async () => {
  try {
    await signOut();
    ui.renderAuthState(null);
  } catch { /* non-fatal */ }
});

// Tear down all match/session state so the pause overlay, input gating, and the
// running rAF loop can't leak into the menu. Shared by the deliberate Leave
// Match action and by involuntary client disconnects (onClose/onError).
function resetMatchState() {
  clearMatchmakingHostTimeout();
  ui.hidePause();
  input.paused = false;
  input.chatting = false;
  try { host?.destroy(); } catch { /* ignore */ }
  try { client?.destroy(); } catch { /* ignore */ }
  try { voice?.teardown(); } catch { /* ignore */ }
  voice = null;
  socialSend = null;
  lastRoster = [];
  ui.closeChat();
  ui.clearChatLog();
  playerMeta.clear();
  inGame = false;
  role = null;
  host = null;
  client = null;
  latestSnapshot = null;
  _isOnline = false;
  _onlineRegion = null;
  _matchResultSubmitted = false;
  sessionGen++; // stops the running rAF loop
}

async function leaveMatch() {
  await cancelRegionQueue();
  resetMatchState();
  ui.showMenu();
}

// ESC toggles the pause menu during active play (not in lobby/menu/spell-draft).
// Opening pause also marks the local player AFK; resuming clears it.
addEventListener("keydown", (e) => {
  if (e.code !== "Escape") return;
  if (!inGame || !latestSnapshot || latestSnapshot.phase === PHASE.LOBBY) return;
  // During spell selection the draft overlay owns Escape (clear picks); let it
  // handle the event and do not also open the pause menu.
  if (latestSnapshot.phase === PHASE.SPELL_SELECTION) return;
  e.preventDefault();
  const paused = ui.togglePause();
  input.paused = paused;
  sendAfk(paused);
  // Resuming: the idle timer was frozen while paused, so reset it now or the
  // very next sample() would immediately re-trip auto-AFK and undo this.
  if (!paused) input.resetActivity();
});

// Enter opens the chat box during active play (not in lobby/spell-draft), and
// only when the pause menu isn't open and chat isn't already open.
addEventListener("keydown", (e) => {
  if (e.code !== "Enter") return;
  if (!inGame || !latestSnapshot || latestSnapshot.phase === PHASE.LOBBY) return;
  if (latestSnapshot.phase === PHASE.SPELL_SELECTION) return;
  if (ui.isChatOpen() || input.paused || ui.isDialogOpen()) return;
  e.preventDefault();
  ui.openChat();
});

ui.on("host", startHosting);
ui.on("join", startJoining);
ui.on("practice", (name, options) => startHosting(name, { ...options, practice: true }));
ui.on("resume", () => { input.paused = false; sendAfk(false); input.resetActivity(); });
ui.on("leaveMatch", leaveMatch);
ui.on("selectSpell", (id) => input.setSelectedSpell(id));
ui.on("spellSlotHotkey", (index, key) => {
  if (input.setSpellSlotHotkey(index, key)) ui.setSpellSlotHotkeys(input.spellSlotHotkeys);
});
ui.on("itemSlotHotkey", (index, key) => {
  if (input.setItemSlotHotkey(index, key)) ui.setItemSlotHotkeys(input.itemSlotHotkeys);
});

// ---- Social UI wiring: chat, mute, settings, disclaimer, PTT rebind ----
ui.on("chatOpen", (open) => {
  input.chatting = !!open;
  if (!open) {
    sendTyping(false);
    // Chat swallows keystrokes without counting them as activity (see
    // input.js), so the idle timer is frozen while open. Reset it on close
    // or a chat session longer than AFK_IDLE_MS trips a spurious auto-AFK
    // the instant the player closes the box and starts playing again.
    input.resetActivity();
  }
});
ui.on("chatSend", (text) => {
  if (text) sendChat(text);
  sendTyping(false);
});
ui.on("chatTyping", (typing) => sendTyping(typing));
ui.on("toggleMute", (peerId) => {
  const m = playerMeta.get(peerId);
  const muted = social.toggleMute(peerId, m?.userId || null);
  voice?.setMuted(peerId, muted);
  ui.refreshRosterMute(peerId, muted);
});
ui.on("clearMutes", (peerIds) => {
  // social.clearMuteList() already wiped the persisted list and the DOM
  // glyphs; voice's <audio> sinks are only reachable from here, so unmute
  // every roster peer's sink too or they stay silently muted all session.
  for (const id of peerIds || []) voice?.setMuted(id, false);
});
ui.on("socialPrefs", (prefs) => {
  if (prefs?.masterVolume != null) voice?.setMasterVolume(prefs.masterVolume);
  if (prefs?.micEnabled && voice && !voice.isAvailable()) voice.init();
  // Re-run the mesh diff immediately: updateRoster() itself gates mesh
  // formation on the mic-enabled opt-in, so toggling it off tears the mesh
  // down right away, and toggling it on forms it right away.
  voice?.updateRoster(lastRoster);
});
ui.on("conductDismiss", () => {});
ui.on("pttKey", (code) => {
  if (setPttKey(code)) input.pttKey = code;
});

// Push-to-talk: enable/disable the outgoing mic track (if voice is available),
// which itself fires onSpeakingChange -> sendSpeak. When the mic was never
// granted, send SPEAK directly so the ring still shows for other viewers.
input.onPtt = (on) => {
  if (voice?.isAvailable()) voice.setTransmitting(on);
  else sendSpeak(on);
};

// Auto-AFK after ~CFG.SOCIAL.AFK_IDLE_MS of no real input; cleared on activity.
input.onAfkChange = (idle) => sendAfk(idle);

// ---- Loading gate: preload assets, then wait for a user gesture to enter. ----
(async () => {
  const loaderEl  = document.getElementById("loader");
  const barEl     = document.getElementById("loader-bar");
  const pctEl     = document.getElementById("loader-pct");
  const enterEl   = document.getElementById("loader-enter");

  const safetyTimeout = new Promise((r) => setTimeout(r, 12000));

  try {
    await Promise.race([
      preloadAssets({
        onProgress(p) {
          const v = Math.min(100, Math.round(p * 100));
          if (barEl) {
            barEl.style.width = v + "%";
            barEl.parentElement?.setAttribute("aria-valuenow", String(v));
          }
          if (pctEl) pctEl.textContent = v + "%";
        },
      }),
      safetyTimeout,
    ]);
  } catch { /* individual asset errors are handled inside preloadAssets */ }

  if (barEl) barEl.style.width = "100%";
  if (pctEl) pctEl.textContent = "100%";
  if (enterEl) enterEl.classList.remove("hidden");

  // Wait for the player's first deliberate interaction.
  await new Promise((resolve) => {
    addEventListener("pointerdown", resolve, { once: true });
    addEventListener("keydown", resolve, { once: true });
  });

  // Unlock audio on this gesture (browsers require a user gesture for AudioContext).
  audio.resume();
  audio.startMusic();

  // Fade the loader out, then reveal the menu.
  if (loaderEl) {
    loaderEl.classList.add("loader-fade-out");
    setTimeout(() => loaderEl.classList.add("hidden"), 560);
  }

  // ---- Boot online services ----
  const onlineEnabled = isEnabled();
  ui.setOnlineEnabled(onlineEnabled);

  // Restore auth session and detect region in parallel.
  const [user, region] = await Promise.allSettled([
    initAuth(),
    getRegion(),
  ]).then((results) => results.map((r) => r.value ?? null));

  if (region) {
    _currentRegion = region;
    ui.setRegion(region);
  }

  // Render initial auth state (signed in, guest, or signed out).
  if (onlineEnabled) {
    ui.renderAuthState(user || getUser());

    // Keep identity badge in sync across the session.
    onAuthChange((updatedUser) => {
      ui.renderAuthState(updatedUser);
    });
  }

  ui.showMenu();
})();
