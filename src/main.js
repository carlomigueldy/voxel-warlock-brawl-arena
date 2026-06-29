// Entry point: wires UI + networking + simulation + renderer into a playable
// host-authoritative P2P game.
import { CFG, MSG } from "./config.js";
import { Simulation, PHASE } from "./sim.js";
import { GameRenderer } from "./renderer.js";
import { InputController } from "./input.js";
import { Host, Client } from "./net.js";
import { UI } from "./ui.js";
import { AudioEngine } from "./audio.js";

const ui = new UI();
const renderer = new GameRenderer(document.getElementById("game-canvas"));
const input = new InputController(renderer);
const audio = new AudioEngine();
renderer.setAudio(audio);
ui.setAudio(audio);
ui.setSpellSlotHotkeys(input.spellSlotHotkeys);

// Browsers require a gesture to start audio; resume on first interaction.
function unlockAudio() {
  audio.resume();
  audio.startMusic();
}
addEventListener("pointerdown", unlockAudio, { once: true });
addEventListener("keydown", unlockAudio, { once: true });
input.onCast = () => audio.resume();

// Metadata about every player (id -> {name, colorIndex}) for labels/scoreboard,
// kept in sync on both host and clients.
const playerMeta = new Map();

let role = null;       // "host" | "client"
let host = null;
let client = null;
let localId = null;
let latestSnapshot = null;
let inGame = false;

// ---------- HOST FLOW ----------
function startHosting(name, options = {}) {
  role = "host";
  ui.setMenuStatus("Creating room…");

  const sim = new Simulation({
    allAbilitiesAtStart: options.allAbilitiesAtStart,
    arenaWorld: options.arenaWorld,
    landSize: options.landSize,
  });

  host = new Host({
    name,
    onReady: ({ code, localId: hid }) => {
      localId = hid;
      renderer.setLocalId(localId);
      // Add the host as a player.
      const p = sim.addPlayer(localId, name);
      playerMeta.set(localId, { name, colorIndex: p.colorIndex });
      ui.showLobby(code, { isHost: true });
      pushLobby();
    },
    onPlayerJoin: (peerId, pname) => {
      const p = sim.addPlayer(peerId, pname);
      playerMeta.set(peerId, { name: pname, colorIndex: p.colorIndex });
      if (sim.phase === PHASE.LOBBY) applyBotSettings();
      // Tell everyone the full meta table so labels/colors match.
      pushLobby();
      if (sim.phase !== PHASE.LOBBY) host.sendTo(peerId, { type: MSG.STATE, ...sim.snapshot() });
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
      playerMeta.set(p.id, { name: p.name, colorIndex: p.colorIndex, isBot: true });
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

    // Apply local host input directly.
    if (sim.phase === PHASE.PLAYING || sim.phase === PHASE.COUNTDOWN) {
      sim.setInput(localId, input.sample());
    }

    acc += dt;
    while (acc >= tickMs / 1000) {
      sim.step(tickMs / 1000);
      acc -= tickMs / 1000;
    }

    // Broadcast snapshot.
    const snap = sim.snapshot();
    latestSnapshot = snap;
    host.broadcast({ type: MSG.STATE, ...snap });

    // Render locally.
    renderer.apply(snap, playerMeta);
    if (snap.phase !== PHASE.LOBBY) {
      ui.updateHUD(snap, localId, playerMeta);
      syncLocalSpellSlots(snap);
      ui.updateAbilityBar(snap, localId);
      playTransitionAudio(snap);
    }
    renderer.update();

    requestAnimationFrame(hostLoop);
  }
  requestAnimationFrame(hostLoop);
}

// ---------- CLIENT FLOW ----------
function startJoining(name, code) {
  role = "client";
  ui.setMenuStatus("Connecting to room " + code + "…");

  client = new Client({
    name, code,
    onWelcome: (msg) => {
      localId = client.localId;
      renderer.setLocalId(localId);
      ui.showLobby(code, { isHost: false });
      ui.setLobbyStatus("Connected! Waiting for host to start…");
    },
    onLobby: (msg) => {
      playerMeta.clear();
      msg.players.forEach((p) => playerMeta.set(p.id, { name: p.name, colorIndex: p.colorIndex, isBot: !!p.isBot }));
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
      // Ensure meta exists for everyone in the snapshot (fallback).
      for (const p of latestSnapshot.players) {
        if (!playerMeta.has(p.id)) playerMeta.set(p.id, { name: "warlock", colorIndex: 0 });
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

// Play transition cues (countdown beeps, round win/lose) by watching snapshots.
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
  return [...playerMeta.entries()].map(([id, m]) => ({ id, name: m.name, colorIndex: m.colorIndex, isBot: !!m.isBot }));
}

function syncLocalSpellSlots(snap) {
  const me = snap.players.find((p) => p.id === localId);
  if (me?.spellSlots) input.setSpellSlots(me.spellSlots);
}

ui.on("host", startHosting);
ui.on("join", startJoining);
ui.on("selectSpell", (id) => input.setSelectedSpell(id));
ui.on("spellSlotHotkey", (index, key) => {
  if (input.setSpellSlotHotkey(index, key)) ui.setSpellSlotHotkeys(input.spellSlotHotkeys);
});

ui.showMenu();
