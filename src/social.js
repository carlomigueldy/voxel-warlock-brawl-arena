// Local per-viewer social prefs: mute list. Pure prefs module — no DOM, no
// THREE. Muting is 100% local/private: it is never sent over the wire, only
// enforced client-side in ui.js (log/roster), renderer.js (bubble/typing/
// ring), and voice.js (<audio>.muted).
//
// Keyed by BOTH peerId and userId: peerId covers guests (and changes on
// reconnect), userId is stable across reconnects when signed in. A remote is
// considered muted if either key matches.

const MUTE_LIST_KEY = "vwb-mute-list";

let _cache = null; // memoized { peers: Set<string>, users: Set<string> }

function load() {
  if (_cache) return _cache;
  let parsed = null;
  try {
    parsed = JSON.parse(localStorage.getItem(MUTE_LIST_KEY) || "{}");
  } catch {
    parsed = {};
  }
  const peers = Array.isArray(parsed?.peers) ? parsed.peers : [];
  const users = Array.isArray(parsed?.users) ? parsed.users : [];
  _cache = { peers: new Set(peers), users: new Set(users) };
  return _cache;
}

function persist() {
  const state = load();
  try {
    localStorage.setItem(
      MUTE_LIST_KEY,
      JSON.stringify({ peers: [...state.peers], users: [...state.users] })
    );
  } catch {}
}

// True if this peerId or userId is on the local mute list.
export function isMuted(peerId, userId = null) {
  const state = load();
  if (peerId && state.peers.has(peerId)) return true;
  if (userId && state.users.has(userId)) return true;
  return false;
}

// Flips the mute state for this peer/user pair, persists, returns the new bool.
export function toggleMute(peerId, userId = null) {
  const next = !isMuted(peerId, userId);
  setMuted(peerId, userId, next);
  return next;
}

// Explicit set (used by toggleMute and any future UI that needs a direct set).
export function setMuted(peerId, userId, muted) {
  const state = load();
  if (peerId) {
    if (muted) state.peers.add(peerId);
    else state.peers.delete(peerId);
  }
  if (userId) {
    if (muted) state.users.add(userId);
    else state.users.delete(userId);
  }
  persist();
}

// Shallow copy of the current mute list (for display/debug/settings panels).
export function getMuteList() {
  const state = load();
  return { peers: [...state.peers], users: [...state.users] };
}

// Wipes the mute list and persists (used by the "clear mute list" settings action).
export function clearMuteList() {
  _cache = { peers: new Set(), users: new Set() };
  persist();
}
