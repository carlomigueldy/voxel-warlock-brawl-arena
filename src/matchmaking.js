import { CFG } from "./config.js";
import { isEnabled, getClient } from "./supabase.js";

function regionById(regions, id) {
  return (regions || []).find((region) => region?.id === id) || null;
}

function sortCandidates(a, b) {
  const joinedAtDiff = Number(a?.joinedAt || 0) - Number(b?.joinedAt || 0);
  if (joinedAtDiff !== 0) return joinedAtDiff;
  return String(a?.queueId || "").localeCompare(String(b?.queueId || ""));
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = String(candidate?.queueId || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeQueueId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `queue-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeMatchId(regionId, pair) {
  const [first, second] = [...pair].sort(sortCandidates);
  return `${regionId}:${first.queueId}:${second.queueId}`;
}

function isOkStatus(status) {
  return status == null || status === "ok" || status?.status === "ok";
}

function isChannelFailure(status) {
  return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED";
}

function isRoomCode(value) {
  return typeof value === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(value.toUpperCase());
}

export function regionScanOrder(homeRegion, regions = CFG.REGIONS) {
  const ordered = [];
  const seen = new Set();
  const add = (region) => {
    if (!region?.id || seen.has(region.id)) return;
    seen.add(region.id);
    ordered.push(region);
  };
  add(regionById(regions, homeRegion));
  for (const region of regions || []) add(region);
  return ordered;
}

export function flattenPresenceState(state) {
  return Object.values(state || {}).flatMap((entries) => Array.isArray(entries) ? entries : []);
}

export function selectPair(candidates) {
  const searching = uniqueCandidates(
    (candidates || [])
      .filter((candidate) =>
        candidate &&
        typeof candidate.queueId === "string" &&
        candidate.status === "searching"
      )
      .sort(sortCandidates)
  );
  if (searching.length < CFG.MATCHMAKING.MATCH_SIZE) return null;
  return searching.slice(0, CFG.MATCHMAKING.MATCH_SIZE);
}

export function electHiddenHost(pair) {
  if (!Array.isArray(pair) || pair.length === 0) return null;
  return [...pair].sort(sortCandidates)[0] || null;
}

export class RegionQueue {
  constructor({ homeRegion, player, regions, onStatus, onHostElected, onOffer, onError }) {
    this.homeRegion = homeRegion || CFG.DEFAULT_REGION;
    this.player = player || {};
    this.regions = regions || CFG.REGIONS;
    this.onStatus = onStatus;
    this.onHostElected = onHostElected;
    this.onOffer = onOffer;
    this.onError = onError;

    this.queueId = makeQueueId();
    this.joinedAt = Date.now();

    this.client = null;
    this.channel = null;
    this.currentRegion = null;
    this.scanOrder = regionScanOrder(this.homeRegion, this.regions);
    this.scanIndex = 0;
    this.activeMatch = null;
    this._tracked = false;
    this._started = false;
    this._canceled = false;
    this._dwellTimer = null;
    this._offerTimer = null;
  }

  start() {
    if (this._started) return this;
    this._started = true;
    this._canceled = false;
    this.client = isEnabled() ? getClient() : null;
    if (!this.client || this.scanOrder.length === 0) {
      this.onError?.({ type: "matchmaking-disabled" });
      return this;
    }
    this._enterRegion(this.scanOrder[this.scanIndex]);
    return this;
  }

  async cancel() {
    this._canceled = true;
    this.activeMatch = null;
    this._clearTimers();
    await this._detachChannel();
  }

  async sendOffer(match, { code }) {
    if (!this.channel || !match || !code) return false;
    try {
      const status = await this.channel.send({
        type: "broadcast",
        event: "match-offer",
        payload: {
          matchId: match.matchId,
          region: match.region,
          code,
          fromQueueId: match.hostQueueId,
          toQueueId: match.guestQueueId,
        },
      });
      if (!isOkStatus(status)) {
        throw Object.assign(new Error("match offer broadcast failed"), {
          type: "matchmaking-broadcast",
          status,
        });
      }
      await this.cancel();
      return true;
    } catch (error) {
      await this.cancel();
      this.onError?.(error);
      return false;
    }
  }

  async _enterRegion(region) {
    if (this._canceled || !region) return;
    await this._detachChannel();
    if (this._canceled) return;

    this.currentRegion = region;
    this.activeMatch = null;
    this._setStatus(`Searching ${region.label || region.id}...`);

    const topic = `${CFG.MATCHMAKING.CHANNEL_PREFIX}:${region.id}`;
    const channel = this.client.channel(topic, { config: { broadcast: { ack: true } } });
    this.channel = channel;

    const sync = () => {
      if (channel !== this.channel || this._canceled) return;
      this._evaluatePair(channel.presenceState?.() || {});
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .on("broadcast", { event: "match-offer" }, ({ payload }) => {
        if (channel !== this.channel || this._canceled) return;
        this._handleOffer(payload);
      })
      .subscribe(async (status, error) => {
        if (channel !== this.channel || this._canceled) return;
        if (isChannelFailure(status)) {
          await this._fail({ type: "matchmaking-channel", status, error });
          return;
        }
        if (status !== "SUBSCRIBED") return;
        try {
          const trackStatus = await channel.track(this._presencePayload(region.id));
          if (!isOkStatus(trackStatus)) {
            throw Object.assign(new Error("matchmaking presence track failed"), {
              type: "matchmaking-track",
              status: trackStatus,
            });
          }
          this._tracked = true;
          this._armDwellTimer();
          sync();
        } catch (error) {
          await this._fail(error);
        }
      });
  }

  _presencePayload(regionId) {
    return {
      queueId: this.queueId,
      name: this.player.name,
      character: this.player.character,
      region: regionId,
      joinedAt: this.joinedAt,
      status: "searching",
    };
  }

  _evaluatePair(state) {
    const pair = selectPair(flattenPresenceState(state));
    if (!pair) return;
    if (!pair.some((candidate) => candidate.queueId === this.queueId)) return;

    const host = electHiddenHost(pair);
    const guest = pair.find((candidate) => candidate.queueId !== host?.queueId) || null;
    if (!host || !guest) return;

    const match = {
      matchId: makeMatchId(this.currentRegion?.id || CFG.DEFAULT_REGION, pair),
      region: this.currentRegion?.id || CFG.DEFAULT_REGION,
      players: pair,
      host,
      guest,
      hostQueueId: host.queueId,
      guestQueueId: guest.queueId,
      localQueueId: this.queueId,
      remoteQueueId: pair.find((candidate) => candidate.queueId !== this.queueId)?.queueId || null,
    };

    if (this.activeMatch?.matchId === match.matchId) return;

    this.activeMatch = match;
    this._clearTimers();
    this._setStatus("Match found. Connecting...");

    if (match.hostQueueId === this.queueId) {
      this.onHostElected?.(match);
      return;
    }

    this._armOfferTimer(match.matchId);
  }

  _handleOffer(payload) {
    if (!payload || !this.activeMatch) return;
    if (payload.toQueueId !== this.queueId) return;
    if (payload.matchId !== this.activeMatch.matchId) return;
    if (payload.fromQueueId !== this.activeMatch.hostQueueId) return;
    if (payload.region !== this.activeMatch.region) return;
    if (!isRoomCode(payload.code)) return;
    this._clearOfferTimer();
    this.onOffer?.({
      match: this.activeMatch,
      code: payload.code.toUpperCase(),
    });
  }

  _armDwellTimer() {
    this._clearDwellTimer();
    this._dwellTimer = setTimeout(() => {
      if (this._canceled || this.activeMatch || this.scanOrder.length <= 1) return;
      this.scanIndex = (this.scanIndex + 1) % this.scanOrder.length;
      const nextRegion = this.scanOrder[this.scanIndex];
      this._setStatus(`Widening search to ${nextRegion.label || nextRegion.id}...`);
      this._enterRegion(nextRegion);
    }, CFG.MATCHMAKING.REGION_DWELL_MS);
  }

  _armOfferTimer(matchId) {
    this._clearOfferTimer();
    this._offerTimer = setTimeout(() => {
      if (this._canceled || this.activeMatch?.matchId !== matchId) return;
      this.activeMatch = null;
      this.scanIndex = (this.scanIndex + 1) % this.scanOrder.length;
      const nextRegion = this.scanOrder[this.scanIndex];
      this._setStatus(`Widening search to ${nextRegion.label || nextRegion.id}...`);
      this._enterRegion(nextRegion);
    }, CFG.MATCHMAKING.OFFER_TIMEOUT_MS);
  }

  _clearTimers() {
    this._clearDwellTimer();
    this._clearOfferTimer();
  }

  _clearDwellTimer() {
    if (!this._dwellTimer) return;
    clearTimeout(this._dwellTimer);
    this._dwellTimer = null;
  }

  _clearOfferTimer() {
    if (!this._offerTimer) return;
    clearTimeout(this._offerTimer);
    this._offerTimer = null;
  }

  async _detachChannel() {
    const channel = this.channel;
    this.channel = null;
    this.currentRegion = null;
    this._clearTimers();
    if (!channel) return;
    try {
      if (this._tracked && typeof channel.untrack === "function") {
        await channel.untrack();
      }
    } catch {
      // Matchmaking is best-effort.
    } finally {
      this._tracked = false;
    }
    try {
      await this.client?.removeChannel(channel);
    } catch {
      // Best-effort cleanup.
    }
  }

  async _fail(error) {
    if (this._canceled) return;
    this._canceled = true;
    this.activeMatch = null;
    this._clearTimers();
    await this._detachChannel();
    this.onError?.(error);
  }

  _setStatus(text) {
    this.onStatus?.(text, { region: this.currentRegion?.id || null });
  }
}
