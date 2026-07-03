// P2P networking via PeerJS, host-authoritative star topology.
//
// - The HOST creates a Peer whose id encodes the room code. It runs the
//   Simulation and broadcasts STATE snapshots. Clients connect to the host.
// - A CLIENT creates an anonymous Peer, connects to the host's id, sends INPUT,
//   and renders the STATE it receives.
//
// PeerJS ships via npm now (no more CDN <script> tag) but is intentionally
// NOT a static `import Peer from "peerjs"` here: peerjs's bundled entry point
// reads `navigator` at module-evaluation time and throws when merely imported
// under plain Node — and this module is statically imported by
// test/social.test.mjs (and dynamically re-imported by the Peer-mocking tests
// in test/source.test.mjs, which swap in a FakePeer via globalThis.Peer) under
// `npm test`. The dynamic import below only ever runs in a real browser.
import { CFG, MSG, makeRoomCode, codeToPeerId } from "./config.js";
import type { DataConnection, Peer as PeerClass, PeerError, PeerErrorType } from "peerjs";
import type { PeerMeta } from "./types.js";

// Ambient globals for the browser-only dynamic `import("peerjs")` path: this
// module assigns `window.Peer` once the dynamic import resolves, and both
// Host/Client construct the bare global `Peer` guarded by
// `typeof Peer === "undefined"` checks. Scoped to this module only. Tests
// substitute a FakePeer via `globalThis.Peer` at runtime, which this typing
// does not affect — `declare const Peer` only describes the shape TS assumes
// for the identifier, it does not constrain what is assigned to it at runtime.
declare global {
  interface Window {
    Peer?: typeof PeerClass;
  }
}
declare const Peer: typeof PeerClass;

// A connection augmented with the identity fields the host stashes on JOIN.
type HostConn = DataConnection & {
  _playerName?: string;
  _character?: string | null;
  _userId?: string | null;
  _region?: string | null;
  _queueId?: string | null;
};

// Non-optional view of the JOIN-derived identity fields, used once they have
// been assigned (before that point they are `undefined`, matching the JS
// behavior where reading an unset property yields `undefined`).
type JoinedHostConn = HostConn & {
  _playerName: string;
  _character: string | null;
  _userId: string | null;
  _region: string | null;
  _queueId: string | null;
};

// Kick off the browser-only peerjs load as soon as this module is imported (the
// menu's asset-loading gate gives it ample time to finish before any Host/Client
// is ever constructed). `_peerReady` lets _initPeer defer construction on the
// vanishingly rare chance a user reaches Host/Join before the module resolves,
// so `new Peer(...)` can never fire against an undefined global.
let _peerReady: Promise<void> | null = null;
if (typeof window !== "undefined" && !window.Peer) {
  _peerReady = import("peerjs").then((mod) => {
    window.Peer = mod.default;
  });
}

function sanitizeName(name?: string | null): string {
  return String(name ?? "warlock").trim().slice(0, 14) || "warlock";
}

export function sanitizeChat(text?: string | null): string {
  const stripped = String(text ?? "")
    .replace(/[\x00-\x1F\x7F]/g, "") // strip control chars
    .replace(/\s+/g, " ")                  // collapse whitespace
    .trim();
  return stripped.slice(0, CFG.SOCIAL.CHAT_MAX_LEN);
}

export function makeChatRateLimiter({ max = CFG.SOCIAL.CHAT_RATE_MAX, windowMs = CFG.SOCIAL.CHAT_RATE_WINDOW_MS }: { max?: number; windowMs?: number } = {}) {
  const hits = new Map<string, number[]>(); // fromId -> number[] (timestamps)
  return function allow(fromId: string): boolean {
    const now = Date.now();
    const arr = (hits.get(fromId) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      hits.set(fromId, arr);
      return false;
    }
    arr.push(now);
    hits.set(fromId, arr);
    return true;
  };
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

interface HostCallbacks {
  onLobby?: (...args: any[]) => void;
  onPlayerJoin?: (peerId: string, name: string, character: string | null, meta: PeerMeta) => void;
  onPlayerLeave?: (peerId: string) => void;
  onReady?: (info: { code: string; peerId: string; localId: string }) => void;
  onError?: (err: any) => void;
  onChat?: (peerId: string, chat: { text: string; kind: "text" }) => void;
  onTyping?: (peerId: string, typing: boolean) => void;
  onAfk?: (peerId: string, afk: boolean) => void;
  onSpeak?: (peerId: string, speaking: boolean) => void;
  onInput?: (peerId: string, msg: any) => void;
  onDraft?: (peerId: string, msg: any) => void;
}

interface HostOptions extends HostCallbacks {
  name: string;
  matchmaking?: { matchId?: string; queueId?: string; allowedQueueIds?: string[] } | null;
}

// ---------------- HOST ----------------
export class Host {
  name: string;
  code: string;
  peerId: string;
  conns: Map<string, HostConn>;
  playerMeta: Map<string, PeerMeta>;
  matchmaking: HostOptions["matchmaking"];
  callbacks: HostCallbacks;
  localId: string;
  _chatLimiter: (fromId: string) => boolean;
  peer?: InstanceType<typeof PeerClass>;

  constructor({ name, matchmaking = null, onLobby, onPlayerJoin, onPlayerLeave, onReady, onError, onChat, onTyping, onAfk, onSpeak }: HostOptions) {
    this.name = name;
    this.code = makeRoomCode();
    this.peerId = codeToPeerId(this.code);
    this.conns = new Map(); // peerId -> DataConnection
    // Per-peer identity metadata populated on JOIN: { userId, region }
    // The host's own entry must be set by the caller via playerMeta.set(host.localId, {...}).
    this.playerMeta = new Map();
    this.matchmaking = matchmaking;
    this.callbacks = { onLobby, onPlayerJoin, onPlayerLeave, onReady, onError, onChat, onTyping, onAfk, onSpeak };
    this.localId = this.peerId; // host plays too
    this._chatLimiter = makeChatRateLimiter();
    this._initPeer();
  }

  _initPeer(attempt = 0): void {
    // Defer until the browser-only peerjs import has populated the global.
    if (typeof Peer === "undefined" && _peerReady) {
      _peerReady.then(() => this._initPeer(attempt));
      return;
    }
    this.peer = new Peer(this.peerId, PEER_OPTS);

    this.peer.on("open", (id: string) => {
      this.callbacks.onReady?.({ code: this.code, peerId: id, localId: this.localId });
    });

    this.peer.on("connection", (conn: DataConnection) => this._onConn(conn as HostConn));

    this.peer.on("error", (err: PeerError<`${PeerErrorType}`>) => {
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

  _onConn(conn: HostConn): void {
    conn.on("open", () => {
      if (this.conns.size + 1 >= CFG.MAX_PLAYERS) {
        conn.send({ type: MSG.WELCOME, full: true });
        setTimeout(() => conn.close(), 200);
        return;
      }
      this.conns.set(conn.peer, conn);
    });

    conn.on("data", (msg: any) => this._onData(conn, msg));
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

  _onData(conn: HostConn, msg: any): void {
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
        {
          const c = conn as JoinedHostConn;
          this.playerMeta.set(c.peer, { userId: c._userId, region: c._region });
          this.callbacks.onPlayerJoin?.(c.peer, c._playerName, c._character, { userId: c._userId, region: c._region });
        }
        // Acknowledge with the player's authoritative id.
        conn.send({ type: MSG.WELCOME, id: conn.peer, hostName: this.name });
        break;
      case MSG.INPUT:
        this.callbacks.onInput?.(conn.peer, msg);
        break;
      case MSG.DRAFT:
        this.callbacks.onDraft?.(conn.peer, msg);
        break;
      case MSG.CHAT: {
        const text = sanitizeChat(msg.text);
        if (!text || !this._chatLimiter(conn.peer)) break;
        this.callbacks.onChat?.(conn.peer, { text, kind: "text" });
        break;
      }
      case MSG.TYPING: this.callbacks.onTyping?.(conn.peer, !!msg.typing);   break;
      case MSG.AFK:    this.callbacks.onAfk?.(conn.peer, !!msg.afk);         break;
      case MSG.SPEAK:  this.callbacks.onSpeak?.(conn.peer, !!msg.speaking);  break;
    }
  }

  onInput(fn: HostCallbacks["onInput"]): void { this.callbacks.onInput = fn; }
  onDraft(fn: HostCallbacks["onDraft"]): void { this.callbacks.onDraft = fn; }
  onChat(fn: HostCallbacks["onChat"]): void { this.callbacks.onChat = fn; }
  onTyping(fn: HostCallbacks["onTyping"]): void { this.callbacks.onTyping = fn; }
  onAfk(fn: HostCallbacks["onAfk"]): void { this.callbacks.onAfk = fn; }
  onSpeak(fn: HostCallbacks["onSpeak"]): void { this.callbacks.onSpeak = fn; }

  // Send a message to every connected client.
  broadcast(obj: any): void {
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send(obj);
    }
  }

  sendTo(peerId: string, obj: any): void {
    const c = this.conns.get(peerId);
    if (c && c.open) c.send(obj);
  }

  // Host is a player too; sanitize + rate-limit the host's own chat line and
  // return the ready-to-broadcast relay object, or null if it was dropped.
  localChat(text: string): { type: string; fromId: string; text: string; kind: "text"; t: number } | null {
    const clean = sanitizeChat(text);
    if (!clean || !this._chatLimiter(this.localId)) return null;
    return { type: MSG.CHAT, fromId: this.localId, text: clean, kind: "text", t: Date.now() };
  }

  // Broadcast the current real-peer roster (bots are never in this.conns, so
  // they are excluded automatically). Returns the peer list for local voice use.
  emitRoster(): string[] {
    const peers = [this.localId, ...this.conns.keys()];
    this.broadcast({ type: MSG.ROSTER, peers });
    return peers;
  }

  _acceptsMatchmakingJoin(msg: any): boolean {
    const expectedMatchId = this.matchmaking?.matchId;
    if (!expectedMatchId) return true;
    if (msg?.matchId !== expectedMatchId) return false;
    const allowedQueueIds = Array.isArray(this.matchmaking?.allowedQueueIds)
      ? this.matchmaking.allowedQueueIds
      : [];
    if (!allowedQueueIds.length) return true;
    return allowedQueueIds.includes(msg?.queueId);
  }

  destroy(): void {
    try { this.peer?.destroy(); } catch {}
  }
}

interface ClientCallbacks {
  onWelcome?: (msg: any) => void;
  onLobby?: (msg: any) => void;
  onState?: (msg: any) => void;
  onStart?: (msg: any) => void;
  onRoundEnd?: (msg: any) => void;
  onMatchEnd?: (msg: any) => void;
  onError?: (err: any) => void;
  onClose?: () => void;
  onChat?: (msg: any) => void;
  onRoster?: (msg: any) => void;
}

interface ClientOptions extends ClientCallbacks {
  name: string;
  code: string;
  character?: string | null;
  userId?: string | null;
  region?: string | null;
  matchmaking?: { matchId?: string; queueId?: string } | null;
}

// ---------------- CLIENT ----------------
export class Client {
  name: string;
  character: string | null;
  userId: string | null;
  region: string | null;
  matchmaking: ClientOptions["matchmaking"];
  code: string;
  hostId: string;
  callbacks: ClientCallbacks;
  localId: string | null;
  _terminalError: boolean;
  peer?: InstanceType<typeof PeerClass>;
  conn?: DataConnection;

  constructor({ name, code, character, userId, region, matchmaking = null, onWelcome, onLobby, onState, onStart, onRoundEnd, onMatchEnd, onError, onClose, onChat, onRoster }: ClientOptions) {
    this.name = name;
    this.character = character || null;
    this.userId = userId || null;
    this.region = region || null;
    this.matchmaking = matchmaking;
    this.code = code.toUpperCase();
    this.hostId = codeToPeerId(this.code);
    this.callbacks = { onWelcome, onLobby, onState, onStart, onRoundEnd, onMatchEnd, onError, onClose, onChat, onRoster };
    this.localId = null;
    this._terminalError = false;
    this._initPeer();
  }

  _initPeer(): void {
    // Defer until the browser-only peerjs import has populated the global.
    if (typeof Peer === "undefined" && _peerReady) {
      _peerReady.then(() => this._initPeer());
      return;
    }
    this.peer = new Peer(PEER_OPTS);
    this.peer.on("open", () => {
      this.conn = this.peer!.connect(this.hostId, { reliable: false });
      this._wireConn();
    });
    this.peer.on("error", (err: any) => this.callbacks.onError?.(err));
  }

  _wireConn(): void {
    const conn = this.conn!;
    conn.on("open", () => {
      this.localId = this.peer!.id;
      const join: any = {
        type: MSG.JOIN,
        name: this.name,
        character: this.character,
        userId: this.userId,
        region: this.region,
      };
      if (this.matchmaking?.matchId) join.matchId = this.matchmaking.matchId;
      if (this.matchmaking?.queueId) join.queueId = this.matchmaking.queueId;
      conn.send(join);
    });
    conn.on("data", (msg: any) => this._onData(msg));
    conn.on("close", () => {
      if (!this._terminalError) this.callbacks.onClose?.();
    });
    conn.on("error", (err: any) => this.callbacks.onError?.(err));
  }

  _onData(msg: any): void {
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
      case MSG.CHAT:   this.callbacks.onChat?.(msg);   break; // {fromId,text,kind,t}
      case MSG.ROSTER: this.callbacks.onRoster?.(msg); break; // {peers}
    }
  }

  sendInput(input: any): void {
    if (this.conn && this.conn.open) {
      this.conn.send({ type: MSG.INPUT, ...input });
    }
  }

  sendDraft(msg: any): void {
    if (this.conn && this.conn.open) {
      this.conn.send({ type: MSG.DRAFT, ...msg });
    }
  }

  sendChat(text: string): void   { if (this.conn?.open) this.conn.send({ type: MSG.CHAT,   text, kind: "text" }); }
  sendTyping(v: boolean): void   { if (this.conn?.open) this.conn.send({ type: MSG.TYPING, typing: !!v }); }
  sendAfk(v: boolean): void      { if (this.conn?.open) this.conn.send({ type: MSG.AFK,    afk: !!v }); }
  sendSpeak(v: boolean): void    { if (this.conn?.open) this.conn.send({ type: MSG.SPEAK,  speaking: !!v }); }

  destroy(): void {
    try { this.peer?.destroy(); } catch {}
  }
}
