// Entry point: wires UI + networking + simulation + renderer + online services.
import { CFG, MSG, getCharacter } from "./config.js";
import { Simulation, PHASE } from "./sim.js";
import { GameRenderer } from "./renderer.js";
import { InputController } from "./input.js";
import { Host, Client } from "./net.js";
import { UI } from "./ui.js";
import { AudioEngine } from "./audio.js";
import { CharacterPreview } from "./preview.js";
import { preloadAssets } from "./loader.js";

// Online services — all modules no-op gracefully when Supabase is not configured.
import { isEnabled } from "./supabase.js";
import { initAuth, getUser, onAuthChange, signUpEmail, signInEmail, signInWithGoogle, signInAsGuest, upgradeGuest, signOut } from "./auth.js";
import { getRegion, setRegion } from "./region.js";
import { publishRoom, heartbeat, closeRoom, listRooms, subscribeRooms, quickMatch as qmatch } from "./matchmaking.js";
import { submitMatchResult, fetchLeaderboard } from "./leaderboard.js";

const ui = new UI();
const renderer = new GameRenderer(document.getElementById("game-canvas"));
const input = new InputController(renderer);
const audio = new AudioEngine();
renderer.setAudio(audio);
ui.setAudio(audio);
ui.setSpellSlotHotkeys(input.spellSlotHotkeys);

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

// --- Online state ---
let _isOnline           = false;  // true when game was started via Online flow
let _onlineRegion       = null;   // region id for the current online session
let _currentRegion      = "sea";  // latest known region (from getRegion / regionChange)
let _heartbeatInterval  = null;
let _matchResultSubmitted = false;
let _roomsUnsub         = null;   // teardown fn from subscribeRooms

// ---------- HOST FLOW ----------
function startHosting(name, options = {}) {
  role = "host";
  ui.setMenuStatus("Creating room…");

  const sim = new Simulation({
    allAbilitiesAtStart: options.allAbilitiesAtStart,
    arenaWorld: options.arenaWorld,
    landSize: options.landSize,
    enabledObstacles: options.enabledObstacles,
  });

  host = new Host({
    name,
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
      ui.showLobby(code, { isHost: true });
      pushLobby();
      // Let main.js do online setup (publish room, heartbeat) after host is ready.
      options.onHostReady?.(code);
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
      if (sim.phase !== PHASE.LOBBY) {
        const welcomeSnap = sim.snapshot({ trackSend: false });
        host.sendTo(peerId, { type: MSG.STATE, ...welcomeSnap, mapLayout: sim.mapLayout });
      }
      ui.setLobbyStatus(`${pname} joined.`);
    },
    onPlayerLeave: (peerId) => {
      const m = playerMeta.get(peerId);
      sim.removePlayer(peerId);
      playerMeta.delete(peerId);
      pushLobby();
      if (sim.phase === PHASE.LOBBY) {
        applyBotSettings();
        ui.showLobby(host.code, { isHost: true });
        inGame = false;
      }
      if (m) ui.setLobbyStatus(`${m.name} left.`);
    },
    onError: (err) => ui.setMenuStatus("Host error: " + (err.type || err.message || err)),
  });

  host.onInput((peerId, msg) => sim.setInput(peerId, msg));

  ui.on("bots", () => {
    applyBotSettings();
    pushLobby();
  });

  ui.on("start", () => {
    applyBotSettings();
    if (!sim.startMatch()) {
      ui.setLobbyStatus("Need at least 2 warlocks to start.");
      return;
    }
    host.broadcast({ type: MSG.START, round: sim.round });
    // Transition online room to in-progress.
    if (_isOnline && isEnabled()) {
      heartbeat({ code: host.code, playerCount: playerMeta.size, status: "in_progress" }).catch(() => {});
    }
    ui.showGame();
    inGame = true;
  });

  function applyBotSettings() {
    const { count, skill } = ui.getBotSettings();
    sim.setBotRoster(count, skill);
    syncBotMeta();
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
    host.broadcast({ type: MSG.LOBBY, players, hostId: localId });
    ui.renderPlayerList(players, localId);
    ui.el.btnStart.classList.toggle("hidden", false);
    ui.el.btnStart.disabled = !sim.canStartMatch();
  }

  // ---- Host authoritative loop ----
  const tickMs = 1000 / CFG.TICK_RATE;
  let acc = 0, last = performance.now();
  function hostLoop(now) {
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

    renderer.apply(snap, playerMeta);
    if (snap.phase !== PHASE.LOBBY) {
      ui.updateHUD(snap, localId, playerMeta);
      syncLocalSpellSlots(snap);
      ui.updateAbilityBar(snap, localId);
      playTransitionAudio(snap);

      // On match end: submit result + close the online room.
      if (snap.phase === PHASE.MATCH_END && _isOnline && !_matchResultSubmitted) {
        _matchResultSubmitted = true;
        _teardownOnlineRoom(snap);
      }
    }
    renderer.update();

    requestAnimationFrame(hostLoop);
  }
  requestAnimationFrame(hostLoop);
}

// ---------- CLIENT FLOW ----------
function startJoining(name, code, character, { userId, region } = {}) {
  role = "client";
  ui.setMenuStatus("Connecting to room " + code + "…");

  client = new Client({
    name, code, character,
    // These extra fields are passed per the data team's net.js contract.
    userId: userId || getUser()?.id || null,
    region: region || _currentRegion,
    onWelcome: (msg) => {
      localId = client.localId;
      renderer.setLocalId(localId);
      playerMeta.set(localId, { name, colorIndex: 0, character: getCharacter(character).id, userId: userId || getUser()?.id || null });
      ui.showLobby(code, { isHost: false });
      ui.setLobbyStatus("Connected! Waiting for host to start…");
    },
    onLobby: (msg) => {
      playerMeta.clear();
      msg.players.forEach((p) => playerMeta.set(p.id, {
        name: p.name, colorIndex: p.colorIndex, isBot: !!p.isBot,
        character: p.character || CFG.DEFAULT_CHARACTER, userId: p.userId || null,
      }));
      ui.renderPlayerList(msg.players, msg.hostId);
    },
    onStart: () => {
      ui.showGame();
      inGame = true;
    },
    onState: (snap) => {
      if (latestSnapshot && snap.t <= latestSnapshot.t) return;
      latestSnapshot = snap;
      if (!inGame && snap.phase !== PHASE.LOBBY) {
        ui.showGame();
        inGame = true;
      }
    },
    onError: (err) => {
      const t = err.type || "";
      if (t === "peer-unavailable") ui.setMenuStatus("Room not found. Check the code.");
      else if (t === "room-full") ui.setMenuStatus("Room is full.");
      else ui.setMenuStatus("Connection error: " + (t || err.message || err));
      ui.showMenu();
    },
    onClose: () => {
      ui.setMenuStatus("Disconnected from host.");
      ui.showMenu();
    },
  });

  // ---- Client loop: send input, render last snapshot ----
  const inputMs = 1000 / CFG.INPUT_RATE;
  let lastInput = 0;
  function clientLoop(now) {
    if (now - lastInput >= inputMs) {
      client.sendInput(input.sample());
      lastInput = now;
    }
    if (latestSnapshot) {
      for (const p of latestSnapshot.players) {
        if (!playerMeta.has(p.id)) playerMeta.set(p.id, { name: "warlock", colorIndex: 0, userId: null });
      }
      renderer.apply(latestSnapshot, playerMeta);
      if (latestSnapshot.phase !== PHASE.LOBBY) {
        ui.updateHUD(latestSnapshot, localId, playerMeta);
        ui.updateAbilityBar(latestSnapshot, localId);
        playTransitionAudio(latestSnapshot);
      }
    }
    renderer.update();
    requestAnimationFrame(clientLoop);
  }
  requestAnimationFrame(clientLoop);
}

// ---------- Online room teardown (host-side) ----------
async function _teardownOnlineRoom(snap) {
  if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
  if (!isEnabled()) return;
  try {
    const payload = _buildMatchPayload(snap);
    await submitMatchResult(payload);
  } catch { /* non-fatal */ }
  try {
    await closeRoom(host.code);
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
}

// ---------- UI event wiring ----------

// LAN host — pure PeerJS, no matchmaking.
ui.on("hostLan", (name, options) => {
  _isOnline = false;
  _matchResultSubmitted = false;
  startHosting(name, options);
});

// Online host — PeerJS + matchmaking publish + heartbeat.
ui.on("hostOnline", async (name, options) => {
  _isOnline = true;
  _matchResultSubmitted = false;
  _onlineRegion = _currentRegion;

  startHosting(name, {
    ...options,
    onHostReady: async (code) => {
      if (!isEnabled()) return;
      try {
        await publishRoom({
          code,
          hostName: name,
          region: _onlineRegion,
          map: options.arenaWorld || CFG.DEFAULT_ARENA_WORLD,
          maxPlayers: CFG.MAX_PLAYERS,
        });
        _heartbeatInterval = setInterval(() => {
          heartbeat({
            code,
            // Count only human players; bots are stored in playerMeta with
            // isBot:true and must not inflate the reported player_count used
            // by matchmaking to determine room capacity.
            playerCount: [...playerMeta.values()].filter(m => !m.isBot).length,
            status: inGame ? "in_progress" : "open",
          }).catch(() => {});
        }, 15000);
      } catch { /* non-fatal: fall back to LAN-only behavior */ }
    },
  });
});

// Quick Match — find best open room for current region and join it.
ui.on("quickMatch", async () => {
  if (!isEnabled()) return ui.setMenuStatus("Online play requires a Supabase project.");
  const name = ui.getName();
  if (!name) return ui.setMenuStatus("Enter a name first.");
  ui.setMenuStatus("Finding a room…");
  try {
    const code = await qmatch(_currentRegion);
    if (code) {
      startJoining(name, code, ui.getCharacter(), { region: _currentRegion });
    } else {
      ui.setMenuStatus("No open rooms found — try hosting instead.");
    }
  } catch {
    ui.setMenuStatus("Quick match failed. Try again.");
  }
});

// Join from room browser (online).
ui.on("joinRoom", (code) => {
  const name = ui.getName();
  if (!name) return ui.setMenuStatus("Enter a name first.");
  startJoining(name, code, ui.getCharacter(), { region: _currentRegion });
});

// LAN join by code — pure PeerJS, no matchmaking.
ui.on("joinByCode", (name, code, character) => {
  _isOnline = false;
  startJoining(name, code, character);
});

// Region change — persist and refresh room list.
ui.on("regionChange", async (id) => {
  _currentRegion = id;
  setRegion(id);
  if (!isEnabled()) return;
  // Refresh rooms for new region.
  if (_roomsUnsub) { _roomsUnsub(); _roomsUnsub = null; }
  _roomsUnsub = subscribeRooms(id, (rooms) => ui.renderRooms(rooms || []));
});

// Screen change — subscribe/unsubscribe rooms when online tab becomes active.
ui.on("screenChange", async (name) => {
  if (name === "online" && isEnabled()) {
    // (Re)subscribe to real-time room list for current region.
    if (_roomsUnsub) { _roomsUnsub(); _roomsUnsub = null; }
    _roomsUnsub = subscribeRooms(_currentRegion, (rooms) => ui.renderRooms(rooms || []));
  } else if (name !== "online" && _roomsUnsub) {
    // Unsubscribe when leaving online screen to save bandwidth.
    _roomsUnsub();
    _roomsUnsub = null;
  }

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

ui.on("googleSignIn", async () => {
  try {
    await signInWithGoogle();
    ui.renderAuthState(getUser());
  } catch (err) {
    ui.setMenuStatus("Google sign-in failed: " + (err.message || err));
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

// Spell bindings — unchanged.
ui.on("selectSpell", (id) => input.setSelectedSpell(id));
ui.on("spellSlotHotkey", (index, key) => {
  if (input.setSpellSlotHotkey(index, key)) ui.setSpellSlotHotkeys(input.spellSlotHotkeys);
});

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
