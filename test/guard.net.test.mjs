// Source guards for the networking layer: net.js, main.js, plus the 3
// behavioral FakePeer Client/Host tests. Split from test/source.test.mjs
// (#103) by which source file each guard reads.
import { test } from "vitest";
import assert from "node:assert";
import fs from "node:fs";
import { Client, Host } from "../src/net.js";

console.log("Source guards (net) checks:");

const main = fs.readFileSync("src/main.js", "utf8");

// legacy text guard — delete in P6
test("host start is gated by Simulation.startMatch result", () => {
  assert.match(main, /if \(!sim\.startMatch\(\)\)/);
});

// legacy text guard — delete in P6
test("host lobby start button uses Simulation.canStartMatch", () => {
  assert.match(main, /sim\.canStartMatch\(\)/);
});

// legacy text guard — delete in P6
test("late clients switch to game view from active state snapshots", () => {
  assert.match(main, /snap\.phase !== PHASE\.LOBBY[\s\S]*ui\.showGame\(\)/);
});

// legacy text guard — delete in P6
test("clients ignore stale state snapshots", () => {
  assert.match(main, /snap\.t <= latestSnapshot\.t/);
});

// legacy text guard — delete in P6
test("network join names are sanitized as strings before slicing", () => {
  const net = fs.readFileSync("src/net.ts", "utf8");
  assert.match(net, /sanitizeName/);
  assert.match(net, /String\(name \?\? "warlock"\)/);
});

// legacy text guard — delete in P6
test("disconnect handling sends the host back to lobby when a match cannot continue", () => {
  assert.match(main, /if \(sim\.phase === PHASE\.LOBBY\)/);
  assert.match(main, /inGame = false/);
});

// legacy text guard — delete in P6
test("host menu no longer exposes an all-abilities toggle (strict slots only, main half)", () => {
  assert.doesNotMatch(main, /allAbilitiesAtStart/);
});

// legacy text guard — delete in P6
test("selected character is networked from client to host on join", () => {
  const net = fs.readFileSync("src/net.ts", "utf8");
  assert.match(net, /type: MSG\.JOIN[\s\S]*name: this\.name[\s\S]*character: this\.character/);
  assert.match(net, /conn\._character/);
});

// legacy text guard — delete in P6
test("host carries each player's character in lobby meta", () => {
  assert.match(main, /character: getCharacter\(character\)\.id/);
  assert.match(main, /character: m\.character \|\| CFG\.DEFAULT_CHARACTER/);
});

// legacy text guard — delete in P6
test("host lobby exposes bot count and difficulty controls (main half)", () => {
  assert.match(main, /sim\.setBotRoster/);
});

// legacy text guard — delete in P6
test("host menu exposes arena world and land size controls (main half)", () => {
  assert.match(main, /arenaWorld: options\.arenaWorld/);
  assert.match(main, /landSize: options\.landSize/);
});

// legacy text guard — delete in P6
test("syncLocalSpellSlots (or setSpellSlots) is called inside both host and client rAF loops in main.js", () => {
  // The host loop already had syncLocalSpellSlots; the client loop got it in Step 8 (A1 fix).
  // We search for the function name appearing at least twice in the file so either loop can
  // use it (the function itself counts as one occurrence; each call-site is another).
  const matches = main.match(/syncLocalSpellSlots/g) || [];
  assert.ok(matches.length >= 3,
    `syncLocalSpellSlots must appear at least 3 times in main.js (definition + host call + client call); found ${matches.length}`);
  // Additionally confirm the client loop block specifically contains it.
  // The client loop is identified by the clientLoop function definition.
  const clientLoopBlock = main.match(/function clientLoop[\s\S]*?requestAnimationFrame\(clientLoop\)/)?.[0] || "";
  assert.match(clientLoopBlock, /syncLocalSpellSlots/,
    "syncLocalSpellSlots must appear inside the clientLoop function body");
});

// legacy text guard — delete in P6
test("hostLoop survives a throwing frame (try/catch wraps body, rAF stays outside)", () => {
  assert.match(main, /function hostLoop[\s\S]*?try \{[\s\S]*?catch[\s\S]*?requestAnimationFrame\(hostLoop\)/);
});

// legacy text guard — delete in P6
test("clientLoop survives a throwing frame (try/catch wraps body, rAF stays outside)", () => {
  assert.match(main, /function clientLoop[\s\S]*?try \{[\s\S]*?catch[\s\S]*?requestAnimationFrame\(clientLoop\)/);
});

// legacy text guard — delete in P6
test("quick match flow no longer imports hosted open_rooms helpers", () => {
  assert.doesNotMatch(main, /quickMatch as qmatch/);
  assert.doesNotMatch(main, /publishRoom/);
  assert.doesNotMatch(main, /heartbeat/);
  assert.doesNotMatch(main, /listRooms/);
  assert.doesNotMatch(main, /subscribeRooms/);
  assert.doesNotMatch(main, /closeRoom/);
});

test("client join payload includes matchmaking metadata when supplied", async () => {
  const originalPeer = globalThis.Peer;
  class FakeConn {
    constructor(peer) {
      this.peer = peer;
      this.handlers = {};
      this.sent = [];
      this.open = true;
    }
    on(event, cb) { this.handlers[event] = cb; }
    send(msg) { this.sent.push(msg); }
    close() { this.open = false; this.handlers.close?.(); }
  }
  class FakePeer {
    constructor(idOrOpts) {
      this.id = typeof idOrOpts === "string" ? idOrOpts : "client-peer";
      this.handlers = {};
      queueMicrotask(() => this.handlers.open?.(this.id));
    }
    on(event, cb) { this.handlers[event] = cb; }
    connect(hostId) {
      this.hostId = hostId;
      this.conn = new FakeConn(hostId);
      queueMicrotask(() => this.conn.handlers.open?.());
      return this.conn;
    }
    destroy() {}
  }
  globalThis.Peer = FakePeer;
  try {
    const client = new Client({
      name: "Mage",
      code: "ABCDEF",
      character: "ember",
      userId: "user-1",
      region: "sea",
      matchmaking: { matchId: "match-1", queueId: "queue-1" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(client.conn.sent.length > 0, "client should send a join payload");
    assert.strictEqual(client.conn.sent[0].matchId, "match-1");
    assert.strictEqual(client.conn.sent[0].queueId, "queue-1");
  } finally {
    globalThis.Peer = originalPeer;
  }
});

test("hidden host rejects mismatched matchmaking joins while LAN hosts still accept normal joins", async () => {
  const originalPeer = globalThis.Peer;
  class FakePeer {
    constructor(idOrOpts) {
      this.id = typeof idOrOpts === "string" ? idOrOpts : "host-peer";
      this.handlers = {};
      queueMicrotask(() => this.handlers.open?.(this.id));
    }
    on(event, cb) { this.handlers[event] = cb; }
    destroy() {}
  }
  class FakeConn {
    constructor(peer = "remote-peer") {
      this.peer = peer;
      this.handlers = {};
      this.sent = [];
      this.open = true;
    }
    on(event, cb) { this.handlers[event] = cb; }
    send(msg) { this.sent.push(msg); }
    close() { this.open = false; this.handlers.close?.(); }
  }
  globalThis.Peer = FakePeer;
  try {
    const rejected = [];
    const hiddenHost = new Host({
      name: "Host",
      matchmaking: { matchId: "match-1", allowedQueueIds: ["queue-guest"] },
      onPlayerJoin: (...args) => rejected.push(args),
    });
    const mismatchConn = new FakeConn("peer-a");
    hiddenHost._onConn(mismatchConn);
    mismatchConn.handlers.open?.();
    hiddenHost._onData(mismatchConn, {
      type: "join",
      name: "Guest",
      character: "ember",
      matchId: "wrong-match",
      queueId: "wrong-queue",
    });
    assert.strictEqual(rejected.length, 0, "hidden host must reject mismatched joins");
    assert.ok(mismatchConn.sent.some((msg) => msg.matchmakingRejected), "client-visible rejection payload expected");

    const accepted = [];
    const lanHost = new Host({
      name: "LAN Host",
      onPlayerJoin: (...args) => accepted.push(args),
    });
    const okConn = new FakeConn("peer-b");
    lanHost._onConn(okConn);
    okConn.handlers.open?.();
    lanHost._onData(okConn, {
      type: "join",
      name: "Guest",
      character: "ember",
    });
    assert.strictEqual(accepted.length, 1, "LAN/private host should still accept normal joins");
    assert.ok(okConn.sent.some((msg) => msg.type === "welcome"), "accepted join should still receive WELCOME");
  } finally {
    globalThis.Peer = originalPeer;
  }
});

test("client terminal join errors are not overwritten by the follow-up close event", async () => {
  const originalPeer = globalThis.Peer;
  class FakeConn {
    constructor(peer) {
      this.peer = peer;
      this.handlers = {};
      this.sent = [];
      this.open = true;
    }
    on(event, cb) { this.handlers[event] = cb; }
    send(msg) { this.sent.push(msg); }
    close() { this.open = false; this.handlers.close?.(); }
  }
  class FakePeer {
    constructor(idOrOpts) {
      this.id = typeof idOrOpts === "string" ? idOrOpts : "client-peer";
      this.handlers = {};
      queueMicrotask(() => this.handlers.open?.(this.id));
    }
    on(event, cb) { this.handlers[event] = cb; }
    connect(hostId) {
      this.conn = new FakeConn(hostId);
      queueMicrotask(() => this.conn.handlers.open?.());
      return this.conn;
    }
    destroy() {}
  }
  globalThis.Peer = FakePeer;
  try {
    const events = [];
    const client = new Client({
      name: "Mage",
      code: "ABCDEF",
      character: "ember",
      onError: (err) => events.push(err.type),
      onClose: () => events.push("close"),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    client._onData({ type: "welcome", matchmakingRejected: true });
    client.conn.close();

    assert.deepStrictEqual(events, ["matchmaking-rejected"],
      "rejection status should not be overwritten by the close that follows it");
  } finally {
    globalThis.Peer = originalPeer;
  }
});

// legacy text guard — delete in P6
test("matchmaking host errors cancel the active queue and return to queue status", () => {
  assert.match(main, /onHostError:/);
  assert.match(main, /cancelRegionQueue\(\{ clearStatus: false \}\)/);
});
