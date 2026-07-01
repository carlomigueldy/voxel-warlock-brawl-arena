import assert from "node:assert";
import fs from "node:fs";
import { CFG } from "../src/config.js";

let passed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function loadMatchmakingModule({ cfg = CFG, isEnabled = () => true, getClient = () => null } = {}) {
  const srcPath = new URL("../src/matchmaking.js", import.meta.url);
  let source = fs.readFileSync(srcPath, "utf8");
  source = source
    .replace(/import\s+\{\s*CFG\s*\}\s+from\s+["']\.\/config\.js["'];?\n/, "const { CFG } = globalThis.__matchmakingTestDeps;\n")
    .replace(/import\s+\{\s*isEnabled,\s*getClient\s*\}\s+from\s+["']\.\/supabase\.js["'];?\n/, "const { isEnabled, getClient } = globalThis.__matchmakingTestDeps;\n");

  globalThis.__matchmakingTestDeps = { CFG: cfg, isEnabled, getClient };
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Date.now()}-${Math.random()}`;
  try {
    return await import(url);
  } finally {
    delete globalThis.__matchmakingTestDeps;
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

console.log("Matchmaking unit checks:");

test("regionScanOrder keeps home region first and preserves remaining CFG order", async () => {
  let writes = 0;
  globalThis.localStorage = {
    setItem() { writes++; },
    getItem() { return null; },
  };
  const { regionScanOrder } = await loadMatchmakingModule();
  const order = regionScanOrder("eu", CFG.REGIONS);
  assert.deepStrictEqual(order.map((region) => region.id), ["eu", "sea", "us-east", "us-west", "sa", "oce"]);
  assert.strictEqual(writes, 0, "region scan order must not persist localStorage");
  delete globalThis.localStorage;
});

test("flattenPresenceState flattens presence maps into payload arrays", async () => {
  const { flattenPresenceState } = await loadMatchmakingModule();
  const flat = flattenPresenceState({
    alpha: [
      { queueId: "a-1", status: "searching" },
      { queueId: "a-2", status: "searching" },
    ],
    beta: [{ queueId: "b-1", status: "searching" }],
  });
  assert.deepStrictEqual(flat.map((entry) => entry.queueId), ["a-1", "a-2", "b-1"]);
});

test("selectPair chooses the first two searching players by joinedAt then queueId", async () => {
  const { selectPair } = await loadMatchmakingModule();
  const pair = selectPair([
    { queueId: "q-3", joinedAt: 30, status: "searching" },
    { queueId: "q-2", joinedAt: 10, status: "away" },
    { queueId: "q-4", joinedAt: 20, status: "searching" },
    { queueId: "q-1", joinedAt: 20, status: "searching" },
  ]);
  assert.deepStrictEqual(pair?.map((entry) => entry.queueId), ["q-1", "q-4"]);
});

test("electHiddenHost returns the earliest joined player and tie-breaks on queueId", async () => {
  const { electHiddenHost } = await loadMatchmakingModule();
  const host = electHiddenHost([
    { queueId: "queue-b", joinedAt: 12_000 },
    { queueId: "queue-a", joinedAt: 12_000 },
  ]);
  assert.strictEqual(host.queueId, "queue-a");
});

test("RegionQueue cancel cleans up presence tracking and removes its channel", async () => {
  let tracked = 0;
  let untracked = 0;
  let removed = 0;
  let topic = null;
  const handlers = {};
  const channel = {
    on(kind, filter, cb) {
      handlers[`${kind}:${filter?.event || "*"}`] = cb;
      return this;
    },
    subscribe(cb) {
      this._subscribe = cb;
      return this;
    },
    async track(payload) {
      tracked++;
      this._trackedPayload = payload;
    },
    async untrack() {
      untracked++;
    },
    async send() {},
    presenceState() {
      return {};
    },
  };
  const client = {
    channel(nextTopic) {
      topic = nextTopic;
      return channel;
    },
    removeChannel(target) {
      if (target === channel) removed++;
    },
  };

  const cfg = {
    ...CFG,
    MATCHMAKING: {
      MATCH_SIZE: 2,
      REGION_DWELL_MS: 5,
      OFFER_TIMEOUT_MS: 10,
      CHANNEL_PREFIX: "matchmaking",
    },
  };

  const { RegionQueue } = await loadMatchmakingModule({
    cfg,
    isEnabled: () => true,
    getClient: () => client,
  });

  const queue = new RegionQueue({
    homeRegion: "sea",
    player: { name: "Mage", character: "ember" },
    regions: CFG.REGIONS,
  });

  queue.start();
  await tick();
  assert.strictEqual(topic, "matchmaking:sea");

  channel._subscribe?.("SUBSCRIBED");
  await tick();

  assert.strictEqual(tracked, 1, "queue must track presence after subscription");
  await queue.cancel();

  assert.strictEqual(untracked, 1, "cancel must untrack presence");
  assert.strictEqual(removed, 1, "cancel must remove the active channel");
});

test("RegionQueue creates broadcast channels with ack enabled before sending offers", async () => {
  let channelOptions = null;
  const channel = {
    on() { return this; },
    subscribe() { return this; },
    async track() { return "ok"; },
    async untrack() {},
    async send() { return "ok"; },
    presenceState() { return {}; },
  };
  const client = {
    channel(_topic, options) {
      channelOptions = options;
      return channel;
    },
    removeChannel() {},
  };
  const { RegionQueue } = await loadMatchmakingModule({
    isEnabled: () => true,
    getClient: () => client,
  });

  const queue = new RegionQueue({
    homeRegion: "sea",
    player: { name: "Mage", character: "ember" },
    regions: CFG.REGIONS,
  });
  queue.start();
  await tick();

  assert.strictEqual(channelOptions?.config?.broadcast?.ack, true,
    "match offers must wait for server ack before the channel is removed");
  await queue.cancel();
});

test("RegionQueue ignores malformed or stale offers for the active match", async () => {
  let offerHandler = null;
  let offers = 0;
  const channel = {
    on(kind, filter, cb) {
      if (kind === "broadcast" && filter?.event === "match-offer") offerHandler = cb;
      return this;
    },
    subscribe() { return this; },
    async track() { return "ok"; },
    async untrack() {},
    presenceState() { return {}; },
  };
  const client = {
    channel() { return channel; },
    removeChannel() {},
  };
  const { RegionQueue } = await loadMatchmakingModule({
    isEnabled: () => true,
    getClient: () => client,
  });
  const queue = new RegionQueue({
    homeRegion: "sea",
    player: { name: "Mage", character: "ember" },
    regions: CFG.REGIONS,
    onOffer: () => { offers++; },
  });
  queue.start();
  await tick();
  queue.activeMatch = {
    matchId: "sea:q-host:q-guest",
    region: "sea",
    hostQueueId: "q-host",
  };
  queue.queueId = "q-guest";

  offerHandler?.({ payload: {
    matchId: "sea:q-host:q-guest",
    region: "eu",
    code: "ABCDEF",
    fromQueueId: "q-host",
    toQueueId: "q-guest",
  } });
  offerHandler?.({ payload: {
    matchId: "sea:q-host:q-guest",
    region: "sea",
    code: "BAD!",
    fromQueueId: "q-host",
    toQueueId: "q-guest",
  } });
  offerHandler?.({ payload: {
    matchId: "sea:q-host:q-guest",
    region: "sea",
    code: "ABCDEF",
    fromQueueId: "q-host",
    toQueueId: "q-guest",
  } });

  assert.strictEqual(offers, 1, "only region-matched room-code offers should be accepted");
  await queue.cancel();
});

test("RegionQueue reports subscription and track failures instead of staying stuck searching", async () => {
  let errors = 0;
  let removed = 0;
  const channel = {
    on() { return this; },
    subscribe(cb) {
      this._subscribe = cb;
      return this;
    },
    async track() { return "error"; },
    async untrack() {},
    presenceState() { return {}; },
  };
  const client = {
    channel() { return channel; },
    removeChannel() { removed++; },
  };
  const { RegionQueue } = await loadMatchmakingModule({
    isEnabled: () => true,
    getClient: () => client,
  });
  const queue = new RegionQueue({
    homeRegion: "sea",
    player: { name: "Mage", character: "ember" },
    regions: CFG.REGIONS,
    onError: () => { errors++; },
  });
  queue.start();
  await tick();
  channel._subscribe?.("CHANNEL_ERROR");
  await tick();

  assert.strictEqual(errors, 1, "channel errors should surface through onError");
  assert.strictEqual(removed, 1, "failed channels should be removed");

  errors = 0;
  removed = 0;
  const queue2 = new RegionQueue({
    homeRegion: "sea",
    player: { name: "Mage", character: "ember" },
    regions: CFG.REGIONS,
    onError: () => { errors++; },
  });
  queue2.start();
  await tick();
  channel._subscribe?.("SUBSCRIBED");
  await tick();

  assert.strictEqual(errors, 1, "track errors should surface through onError");
  assert.strictEqual(removed, 1, "track failures should remove the channel");
});

test("RegionQueue sendOffer broadcasts the match offer payload and reflects the ack status", async () => {
  let sentPayload = null;
  let ackStatus = "ok";
  const channel = {
    on() { return this; },
    subscribe() { return this; },
    async track() { return "ok"; },
    async untrack() {},
    async send(payload) {
      sentPayload = payload;
      return ackStatus;
    },
    presenceState() { return {}; },
  };
  const client = {
    channel() { return channel; },
    removeChannel() {},
  };
  const { RegionQueue } = await loadMatchmakingModule({
    isEnabled: () => true,
    getClient: () => client,
  });
  const queue = new RegionQueue({
    homeRegion: "sea",
    player: { name: "Mage", character: "ember" },
    regions: CFG.REGIONS,
  });
  queue.start();
  await tick();

  const match = {
    matchId: "sea:q-host:q-guest",
    region: "sea",
    hostQueueId: "q-host",
    guestQueueId: "q-guest",
  };

  const ok = await queue.sendOffer(match, { code: "ABCDEF" });
  assert.deepStrictEqual(sentPayload, {
    type: "broadcast",
    event: "match-offer",
    payload: {
      matchId: "sea:q-host:q-guest",
      region: "sea",
      code: "ABCDEF",
      fromQueueId: "q-host",
      toQueueId: "q-guest",
    },
  });
  assert.strictEqual(ok, true, "sendOffer should resolve truthy when the ack status is ok");

  const queue2 = new RegionQueue({
    homeRegion: "sea",
    player: { name: "Mage", character: "ember" },
    regions: CFG.REGIONS,
  });
  queue2.start();
  await tick();
  ackStatus = "error";
  const failed = await queue2.sendOffer(match, { code: "ABCDEF" });
  assert.strictEqual(failed, false, "sendOffer should resolve falsey when the ack status is non-ok");
});

test("RegionQueue dwell timer advances scanIndex and re-enters the next region only when no activeMatch is set", async () => {
  const topics = [];
  const channel = {
    on() { return this; },
    subscribe(cb) {
      this._subscribe = cb;
      return this;
    },
    async track() { return "ok"; },
    async untrack() {},
    async send() { return "ok"; },
    presenceState() { return {}; },
  };
  const client = {
    channel(topic) {
      topics.push(topic);
      return channel;
    },
    removeChannel() {},
  };

  const cfg = {
    ...CFG,
    MATCHMAKING: {
      MATCH_SIZE: 2,
      REGION_DWELL_MS: 5,
      OFFER_TIMEOUT_MS: 10_000,
      CHANNEL_PREFIX: "matchmaking",
    },
  };

  const { RegionQueue } = await loadMatchmakingModule({
    cfg,
    isEnabled: () => true,
    getClient: () => client,
  });

  const queue = new RegionQueue({
    homeRegion: "sea",
    player: { name: "Mage", character: "ember" },
    regions: CFG.REGIONS,
  });
  queue.start();
  await tick();
  channel._subscribe?.("SUBSCRIBED");
  await tick();

  assert.strictEqual(queue.scanIndex, 0);
  assert.strictEqual(queue.currentRegion?.id, "sea");

  // With no activeMatch, the dwell timer should advance scanIndex and re-enter the next region.
  await new Promise((resolve) => setTimeout(resolve, cfg.MATCHMAKING.REGION_DWELL_MS + 20));
  channel._subscribe?.("SUBSCRIBED");
  await tick();

  assert.strictEqual(queue.scanIndex, 1 % queue.scanOrder.length, "scanIndex should advance modulo scanOrder length");
  assert.strictEqual(queue.currentRegion?.id, queue.scanOrder[1].id, "queue should re-enter the next region in scan order");
  assert.strictEqual(topics.at(-1), `matchmaking:${queue.scanOrder[1].id}`, "channel topic should reflect the new region");

  const indexBeforeMatch = queue.scanIndex;
  const regionBeforeMatch = queue.currentRegion?.id;
  queue.activeMatch = { matchId: "sea:q-host:q-guest", region: regionBeforeMatch };

  // With an activeMatch set, the dwell timer must not advance the region.
  await new Promise((resolve) => setTimeout(resolve, cfg.MATCHMAKING.REGION_DWELL_MS + 20));
  await tick();

  assert.strictEqual(queue.scanIndex, indexBeforeMatch, "scanIndex must not advance while a match is active");
  assert.strictEqual(queue.currentRegion?.id, regionBeforeMatch, "region must not change while a match is active");

  queue.activeMatch = null;
  await queue.cancel();
});

for (const { name, fn } of tests) {
  try {
    await fn();
    console.log("  ok  -", name);
    passed++;
  } catch (e) {
    console.error("  FAIL-", name, "\n", e.message);
    process.exitCode = 1;
  }
}
console.log(`\n${passed} matchmaking checks passed.`);
