// P2P networking via PeerJS, host-authoritative star topology.
//
// - The HOST creates a Peer whose id encodes the room code. It runs the
//   Simulation and broadcasts STATE snapshots. Clients connect to the host.
// - A CLIENT creates an anonymous Peer, connects to the host's id, sends INPUT,
//   and renders the STATE it receives.
//
// PeerJS is loaded globally from a <script> tag (window.Peer).
import { CFG, MSG, makeRoomCode, codeToPeerId } from "./config.js";

function sanitizeName(name) {
  return String(name ?? "warlock").trim().slice(0, 14) || "warlock";
}

const PEER_OPTS = {
  // Public PeerJS cloud broker for signaling. (Media/data still flow P2P.)
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ],
  },
  debug: 1,
};

// ---------------- HOST ----------------
export class Host {
  constructor({ name, matchmaking = null, onLobby, onPlayerJoin, onPlayerLeave, onReady, onError }) {
    this.name = name;
    this.code = makeRoomCode();
    this.peerId = codeToPeerId(this.code);
    this.conns = new Map(); // peerId -> DataConnection
    // Per-peer identity metadata populated on JOIN: { userId, region }
    // The host's own entry must be set by the caller via playerMeta.set(host.localId, {...}).
    this.playerMeta = new Map();
    this.matchmaking = matchmaking;
    this.callbacks = { onLobby, onPlayerJoin, onPlayerLeave, onReady, onError };
    this.localId = this.peerId; // host plays too
    this._initPeer();
  }

  _initPeer(attempt = 0) {
    this.peer = new Peer(this.peerId, PEER_OPTS);

    this.peer.on("open", (id) => {
      this.callbacks.onReady?.({ code: this.code, peerId: id, localId: this.localId });
    });

    this.peer.on("connection", (conn) => this._onConn(conn));

    this.peer.on("error", (err) => {
      // If the chosen room code id is taken, regenerate and retry a few times.
      if (err.type === "unavailable-id" && attempt < 5) {
        this.code = makeRoomCode();
        this.peerId = codeToPeerId(this.code);
        this.localId = this.peerId;
        this._initPeer(attempt + 1);
        return;
      }
      this.callbacks.onError?.(err);
    });
  }

  _onConn(conn) {
    conn.on("open", () => {
      if (this.conns.size + 1 >= CFG.MAX_PLAYERS) {
        conn.send({ type: MSG.WELCOME, full: true });
        setTimeout(() => conn.close(), 200);
        return;
      }
      this.conns.set(conn.peer, conn);
    });

    conn.on("data", (msg) => this._onData(conn, msg));
    conn.on("close", () => {
      this.conns.delete(conn.peer);
      if (this.playerMeta.has(conn.peer)) {
        this.playerMeta.delete(conn.peer);
        this.callbacks.onPlayerLeave?.(conn.peer);
      }
    });
    conn.on("error", () => {
      this.conns.delete(conn.peer);
      if (this.playerMeta.has(conn.peer)) {
        this.playerMeta.delete(conn.peer);
        this.callbacks.onPlayerLeave?.(conn.peer);
      }
    });
  }

  _onData(conn, msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case MSG.JOIN:
        if (this.matchmaking && !this._acceptsMatchmakingJoin(msg)) {
          this.conns.delete(conn.peer);
          conn.send({ type: MSG.WELCOME, matchmakingRejected: true });
          setTimeout(() => conn.close(), 50);
          break;
        }
        conn._playerName = sanitizeName(msg.name);
        conn._character = typeof msg.character === "string" ? msg.character : null;
        conn._userId = typeof msg.userId === "string" ? msg.userId : null;
        conn._region = typeof msg.region === "string" ? msg.region : null;
        conn._queueId = typeof msg.queueId === "string" ? msg.queueId : null;
        this.playerMeta.set(conn.peer, { userId: conn._userId, region: conn._region });
        this.callbacks.onPlayerJoin?.(conn.peer, conn._playerName, conn._character, { userId: conn._userId, region: conn._region });
        // Acknowledge with the player's authoritative id.
        conn.send({ type: MSG.WELCOME, id: conn.peer, hostName: this.name });
        break;
      case MSG.INPUT:
        this.callbacks.onInput?.(conn.peer, msg);
        break;
      case MSG.DRAFT:
        this.callbacks.onDraft?.(conn.peer, msg);
        break;
    }
  }

  onInput(fn) { this.callbacks.onInput = fn; }
  onDraft(fn) { this.callbacks.onDraft = fn; }

  // Send a message to every connected client.
  broadcast(obj) {
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send(obj);
    }
  }

  sendTo(peerId, obj) {
    const c = this.conns.get(peerId);
    if (c && c.open) c.send(obj);
  }

  _acceptsMatchmakingJoin(msg) {
    const expectedMatchId = this.matchmaking?.matchId;
    if (!expectedMatchId) return true;
    if (msg?.matchId !== expectedMatchId) return false;
    const allowedQueueIds = Array.isArray(this.matchmaking?.allowedQueueIds)
      ? this.matchmaking.allowedQueueIds
      : [];
    if (!allowedQueueIds.length) return true;
    return allowedQueueIds.includes(msg?.queueId);
  }

  destroy() {
    try { this.peer?.destroy(); } catch {}
  }
}

// ---------------- CLIENT ----------------
export class Client {
  constructor({ name, code, character, userId, region, matchmaking = null, onWelcome, onLobby, onState, onStart, onRoundEnd, onMatchEnd, onError, onClose }) {
    this.name = name;
    this.character = character || null;
    this.userId = userId || null;
    this.region = region || null;
    this.matchmaking = matchmaking;
    this.code = code.toUpperCase();
    this.hostId = codeToPeerId(this.code);
    this.callbacks = { onWelcome, onLobby, onState, onStart, onRoundEnd, onMatchEnd, onError, onClose };
    this.localId = null;
    this._terminalError = false;
    this._initPeer();
  }

  _initPeer() {
    this.peer = new Peer(PEER_OPTS);
    this.peer.on("open", () => {
      this.conn = this.peer.connect(this.hostId, { reliable: false });
      this._wireConn();
    });
    this.peer.on("error", (err) => this.callbacks.onError?.(err));
  }

  _wireConn() {
    this.conn.on("open", () => {
      this.localId = this.peer.id;
      const join = {
        type: MSG.JOIN,
        name: this.name,
        character: this.character,
        userId: this.userId,
        region: this.region,
      };
      if (this.matchmaking?.matchId) join.matchId = this.matchmaking.matchId;
      if (this.matchmaking?.queueId) join.queueId = this.matchmaking.queueId;
      this.conn.send(join);
    });
    this.conn.on("data", (msg) => this._onData(msg));
    this.conn.on("close", () => {
      if (!this._terminalError) this.callbacks.onClose?.();
    });
    this.conn.on("error", (err) => this.callbacks.onError?.(err));
  }

  _onData(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case MSG.WELCOME:
        if (msg.full) {
          this._terminalError = true;
          this.callbacks.onError?.({ type: "room-full" });
          return;
        }
        if (msg.matchmakingRejected) {
          this._terminalError = true;
          this.callbacks.onError?.({ type: "matchmaking-rejected" });
          return;
        }
        this.callbacks.onWelcome?.(msg);
        break;
      case MSG.LOBBY: this.callbacks.onLobby?.(msg); break;
      case MSG.START: this.callbacks.onStart?.(msg); break;
      case MSG.STATE: this.callbacks.onState?.(msg); break;
      case MSG.ROUND_END: this.callbacks.onRoundEnd?.(msg); break;
      case MSG.MATCH_END: this.callbacks.onMatchEnd?.(msg); break;
    }
  }

  sendInput(input) {
    if (this.conn && this.conn.open) {
      this.conn.send({ type: MSG.INPUT, ...input });
    }
  }

  sendDraft(msg) {
    if (this.conn && this.conn.open) {
      this.conn.send({ type: MSG.DRAFT, ...msg });
    }
  }

  destroy() {
    try { this.peer?.destroy(); } catch {}
  }
}
