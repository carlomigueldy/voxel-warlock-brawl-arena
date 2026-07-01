// Dev FPS/stats overlay — OFF by default, browser-only.
// Enable via ?stats=1 in the URL, or toggle at runtime with the F3 key.
let Stats = null;
let statsInstance = null;
let enabled = false;
let initialized = false;

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

async function ensureStats() {
  if (Stats) return Stats;
  const mod = await import("three/addons/libs/stats.module.js");
  Stats = mod.default || mod;
  return Stats;
}

function applyVisibility() {
  if (!statsInstance) return;
  statsInstance.dom.style.display = enabled ? "block" : "none";
}

async function init() {
  if (!isBrowser() || initialized) return;
  initialized = true;

  const initiallyEnabled = new URLSearchParams(location.search).get("stats") === "1";

  window.addEventListener("keydown", (e) => {
    if (e.key === "F3" || e.code === "F3") {
      e.preventDefault();
      toggle();
    }
  });

  if (initiallyEnabled) {
    await enable();
  }
}

async function enable() {
  if (!isBrowser()) return;
  const StatsCtor = await ensureStats();
  if (!statsInstance) {
    statsInstance = new StatsCtor();
    statsInstance.dom.style.position = "fixed";
    statsInstance.dom.style.top = "0";
    statsInstance.dom.style.left = "0";
    statsInstance.dom.style.zIndex = "10000";
    document.body.appendChild(statsInstance.dom);
  }
  enabled = true;
  applyVisibility();
}

function disable() {
  enabled = false;
  applyVisibility();
}

async function toggle() {
  if (enabled) disable();
  else await enable();
}

function begin() {
  if (enabled && statsInstance) statsInstance.begin();
}

function end() {
  if (enabled && statsInstance) statsInstance.end();
}

export const perf = { init, enable, disable, toggle, begin, end, get enabled() { return enabled; } };
export default perf;
