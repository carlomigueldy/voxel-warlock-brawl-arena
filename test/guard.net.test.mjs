// Source guards for the networking layer: net.ts, plus the 3 behavioral
// FakePeer Client/Host tests. Split from test/source.test.mjs (#103) by
// which source file each guard reads; trimmed again in P6 (#179) when the
// main.js-reading assertions below died with main.js itself — the 2 net.ts
// assertions and the 3 pure-behavioral tests have no main.js dependency and
// still hold unchanged.
import { test } from "vitest";
import assert from "node:assert";
import fs from "node:fs";
import { Client, Host } from "../src/net.js";

console.log("Source guards (net) checks:");

test("network join names are sanitized as strings before slicing", () => {
  const net = fs.readFileSync("src/net.ts", "utf8");
  assert.match(net, /sanitizeName/);
  assert.match(net, /String\(name \?\? "warlock"\)/);
});

test("selected character is networked from client to host on join", () => {
  const net = fs.readFileSync("src/net.ts", "utf8");
  assert.match(net, /type: MSG\.JOIN[\s\S]*name: this\.name[\s\S]*character: this\.character/);
  assert.match(net, /conn\._character/);
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
