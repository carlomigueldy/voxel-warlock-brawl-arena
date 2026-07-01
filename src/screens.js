// ScreenDirector — cinematic top-level screen transitions (menu ↔ lobby ↔ game).
// Self-contained observer module (no ui.js/main.js edits): watches #menu / #lobby
// / #hud for `.hidden` toggles and layers FX (flash + ember burst), a fade-in, a
// menuCue, and a "ROUND 1" card on lobby→game, so the instant .hidden swap reads
// as a cinematic crossfade. All motion degrades under prefers-reduced-motion
// (audio cue is always kept).
import { FX } from "./fx.js";
import { menuCue } from "./audio.js";

const SCREEN_IDS = ["menu", "lobby", "hud"];
const HIDDEN = "hidden";
const FADE_MS = 320;
const ROUND_CARD_MS = 1400;
const FLASH_COLOR = "rgba(255,90,60,0.35)";
const ARCANE_RGBA = "rgba(108,76,255,0.55)";

let currentScreen = null;
const wasHidden = new Set();

function el(id) {
  return document.getElementById(id);
}

function injectStyles() {
  if (document.getElementById("sd-styles")) return;
  const style = document.createElement("style");
  style.id = "sd-styles";
  style.textContent = `
@keyframes sdFadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}
.sd-enter { animation: sdFadeIn ${FADE_MS}ms var(--ease-spring) both; }
@keyframes sdRoundCard {
  0%   { opacity: 0; transform: scale(0.82); }
  14%  { opacity: 1; transform: scale(1); }
  86%  { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.06); }
}
.sd-round-card {
  position: fixed; inset: 0; z-index: 9000;
  display: flex; align-items: center; justify-content: center;
  background: ${ARCANE_RGBA};
  background: color-mix(in srgb, var(--arcane) 55%, transparent);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  pointer-events: none;
}
.sd-round-card__text {
  font-family: var(--font-display);
  font-size: clamp(28px, 8vw, 72px);
  color: #ffffff;
  letter-spacing: 0.14em;
  text-shadow: 0 0 26px var(--arcane), 0 4px 0 rgba(0,0,0,0.55);
  animation: sdRoundCard ${ROUND_CARD_MS}ms var(--ease-spring) both;
}
@media (prefers-reduced-motion: reduce) {
  .sd-enter { animation: none; }
}
`;
  document.head.appendChild(style);
}

function fadeIn(node) {
  if (!node || FX.reducedMotion) return;
  node.classList.remove("sd-enter");
  void node.offsetWidth;
  node.classList.add("sd-enter");
  setTimeout(() => node.classList.remove("sd-enter"), FADE_MS + 40);
}

function showRoundCard() {
  const card = document.createElement("div");
  card.className = "sd-round-card";
  card.setAttribute("aria-hidden", "true");
  const text = document.createElement("div");
  text.className = "sd-round-card__text";
  text.textContent = "ROUND 1";
  card.appendChild(text);
  document.body.appendChild(card);
  menuCue("transition");
  const remove = () => { if (card.parentNode) card.remove(); };
  text.addEventListener("animationend", remove, { once: true });
  setTimeout(remove, ROUND_CARD_MS + 240);
}

function onTransition(fromScreen, toScreen) {
  const reduced = FX.reducedMotion;
  if (!reduced) {
    FX.flash(FLASH_COLOR, 140);
    FX.burst(window.innerWidth / 2, window.innerHeight / 2, "ember", 14);
  }
  menuCue("transition");
  fadeIn(el(toScreen));
  if (!reduced && fromScreen === "lobby" && toScreen === "hud") {
    showRoundCard();
  }
}

function handleMutations(records) {
  for (const r of records) {
    const node = r.target;
    const id = node.id;
    if (!SCREEN_IDS.includes(id)) continue;
    const nowHidden = node.classList.contains(HIDDEN);
    const wasH = wasHidden.has(id);
    if (nowHidden) wasHidden.add(id); else wasHidden.delete(id);
    if (wasH && !nowHidden) {
      onTransition(currentScreen, id);
      currentScreen = id;
    }
  }
}

function init() {
  injectStyles();
  for (const id of SCREEN_IDS) {
    const node = el(id);
    if (!node) continue;
    if (node.classList.contains(HIDDEN)) {
      wasHidden.add(id);
    } else {
      wasHidden.delete(id);
      if (!currentScreen) currentScreen = id;
    }
  }
  const obs = new MutationObserver(handleMutations);
  for (const id of SCREEN_IDS) {
    const node = el(id);
    if (node) obs.observe(node, { attributes: true, attributeFilter: ["class"] });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
