// Real-time push-to-talk voice chat over a direct PeerJS media mesh.
//
// Game data (chat/typing/afk/speak) stays host-star (see net.js); voice audio
// is a separate direct peer-to-peer mesh — every participant calls (or
// answers) every other participant directly so voice never routes through
// the host. Mic capture is opt-in/lazy and the outgoing track stays disabled
// until push-to-talk engages. Degrades gracefully: with no mic permission,
// everything else keeps working and isAvailable() simply reports false.
//
// Not wired into main.js yet — this module is additive and self-contained.

export class VoiceChat {
  constructor({ getPeer, getRoster, isMuted, onSpeakingChange, getPrefs } = {}) {
    this.getPeer = getPeer || (() => null);
    this.getRoster = getRoster || (() => []);
    this.isMuted = isMuted || (() => false);
    this.onSpeakingChange = onSpeakingChange || (() => {});
    this.getPrefs = getPrefs || (() => ({}));

    this._stream = null;        // local mic MediaStream, null until init() succeeds
    this._track = null;         // the single captured audio track (.enabled toggled by PTT)
    this._available = false;    // mic granted + init attempted successfully
    this._initAttempted = false;
    this._transmitting = false;
    this._conns = new Map();    // peerId -> { call, audioEl }
    this._callHandlerBound = false;
  }

  // Requests mic permission and captures ONE track, kept disabled until PTT.
  // Resolves false (never throws) when permission is denied or unavailable.
  async init() {
    if (this._initAttempted) return this._available;
    this._initAttempted = true;
    this._bindIncomingCalls();
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this._track = this._stream.getAudioTracks()[0] || null;
      if (this._track) this._track.enabled = false; // silent until push-to-talk
      this._available = true;
      // updateRoster() may already have run (and formed connections) before
      // getUserMedia() resolved, in which case those calls/answers went out
      // with a null stream and never carry audio. Tear them down now that the
      // real stream exists and let updateRoster() recreate them with it
      // attached — both peers on the call run the same code, so the mesh
      // self-heals on the next roster diff either side triggers.
      if (this._conns.size) {
        for (const id of [...this._conns.keys()]) this._teardownConn(id);
      }
      this.updateRoster();
    } catch {
      this._stream = null;
      this._track = null;
      this._available = false;
    }
    return this._available;
  }

  // Answers every inbound call, unless voice chat is currently opted out (in
  // which case we refuse rather than silently listen in — see updateRoster).
  _bindIncomingCalls() {
    if (this._callHandlerBound) return;
    const peer = this.getPeer?.();
    if (!peer) return;
    this._callHandlerBound = true;
    peer.on("call", (call) => {
      if (!this.getPrefs?.()?.micEnabled) {
        try { call.close(); } catch {}
        return;
      }
      call.answer(this._stream || undefined);
      this._attach(call.peer, call);
    });
  }

  _attach(peerId, call) {
    const prior = this._conns.get(peerId);
    if (prior) this._teardownConn(peerId);
    const entry = { call, audioEl: null };
    this._conns.set(peerId, entry);
    call.on("stream", (remoteStream) => {
      const el = document.createElement("audio");
      el.id = `voice-audio-${peerId}`;
      el.autoplay = true;
      el.srcObject = remoteStream;
      el.muted = !!this.isMuted?.(peerId);
      el.volume = this.getPrefs?.()?.masterVolume ?? 1;
      document.body.appendChild(el);
      entry.audioEl = el;
    });
    call.on("close", () => this._teardownConn(peerId));
    call.on("error", () => this._teardownConn(peerId));
  }

  _teardownConn(peerId) {
    const entry = this._conns.get(peerId);
    if (!entry) return;
    try { entry.call?.close(); } catch {}
    if (entry.audioEl) {
      try { entry.audioEl.srcObject = null; } catch {}
      try { entry.audioEl.remove(); } catch {}
    }
    this._conns.delete(peerId);
  }

  // Diffs the mesh against the current roster: calls new remote ids, closes
  // dropped ones. Dedupe glare: only *initiate* to ids that sort after ours
  // (lexical compare of PeerJS ids); we always answer inbound calls regardless,
  // so exactly one audio path forms per pair either way.
  updateRoster(peers) {
    const peer = this.getPeer?.();
    if (!peer) return;
    // Voice chat is opt-in (settings toggle "Voice chat (push-to-talk)"). If
    // the player has it off, tear down/refuse the media mesh entirely rather
    // than silently listening in — leaving it off should mean no voice at all,
    // not just "can't transmit" — and release the mic capture too, so the
    // browser's mic-in-use indicator actually turns off.
    if (!this.getPrefs?.()?.micEnabled) {
      for (const id of [...this._conns.keys()]) this._teardownConn(id);
      this._stopLocalCapture();
      return;
    }
    this._bindIncomingCalls();
    const localId = peer.id;
    const list = Array.isArray(peers) ? peers : (this.getRoster?.() || []);
    const remoteIds = new Set(list.filter((id) => id && id !== localId));

    for (const id of [...this._conns.keys()]) {
      if (!remoteIds.has(id)) this._teardownConn(id);
    }
    for (const id of remoteIds) {
      if (this._conns.has(id)) continue;
      if (!(localId < id)) continue; // the other side is responsible for initiating
      try {
        const call = peer.call(id, this._stream || undefined);
        if (call) this._attach(id, call);
      } catch {}
    }
  }

  // Enables/disables the local mic track (push-to-talk) and fires the hook
  // so callers can broadcast a SPEAK state message.
  setTransmitting(on) {
    const next = !!on;
    if (this._transmitting === next) return;
    this._transmitting = next;
    if (this._track) this._track.enabled = next;
    this.onSpeakingChange?.(next);
  }

  // Mutes/unmutes a single remote's <audio> sink (local-only, per social.js).
  setMuted(peerId, muted) {
    const entry = this._conns.get(peerId);
    if (entry?.audioEl) entry.audioEl.muted = !!muted;
  }

  // Applies master volume to every remote <audio> sink.
  setMasterVolume(v01) {
    const vol = Math.max(0, Math.min(1, v01 ?? 1));
    for (const entry of this._conns.values()) {
      if (entry.audioEl) entry.audioEl.volume = vol;
    }
  }

  // True once mic permission was granted (init() succeeded).
  isAvailable() {
    return this._available;
  }

  // Stops mic capture (track + stream) and marks voice unavailable, without
  // touching existing media connections/roster — used both by teardown() and
  // by updateRoster() when the player opts out mid-session. Resets
  // _initAttempted so a later re-enable calls getUserMedia() again instead of
  // silently staying unavailable forever.
  _stopLocalCapture() {
    this.setTransmitting(false);
    if (this._track) { try { this._track.stop(); } catch {} }
    if (this._stream) { for (const t of this._stream.getTracks()) { try { t.stop(); } catch {} } }
    this._stream = null;
    this._track = null;
    this._available = false;
    this._initAttempted = false;
  }

  // Releases the mic and closes every media connection + <audio> sink.
  teardown() {
    for (const id of [...this._conns.keys()]) this._teardownConn(id);
    this._conns.clear();
    this._stopLocalCapture();
  }
}
