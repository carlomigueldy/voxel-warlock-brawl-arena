// Wave-2 juice for the spell-draft overlay: per-school hover glow, lock-in
// burst + chord, escalating countdown ticks, and an all-locked celebration.
// Self-contained — observes ui.js DOM via MutationObserver / event delegation,
// never edits ui.js. Loaded by index.html alongside the other juice modules.
import { FX } from "./fx.js";
import { menuCue } from "./audio.js";

const SCHOOLS = [
  { id: "ember",  rgb: [255, 90, 60],  burst: "ember" },
  { id: "arcane", rgb: [108, 76, 255], burst: "rune" },
  { id: "rune",   rgb: [124, 255, 90], burst: "rune" },
  { id: "gold",   rgb: [255, 210, 60], burst: "spark" },
  { id: "pink",   rgb: [255, 76, 168], burst: "confetti" },
  { id: "cyan",   rgb: [76, 201, 255], burst: "shard" },
];
const DEFAULT_SCHOOL = SCHOOLS[1]; // arcane
const STYLE_ID = "dj-style";
const EASE = "var(--ease-spring, cubic-bezier(.2,.8,.2,1))";

const $ = (id) => document.getElementById(id);
const overlay = () => $("spell-draft");
const isOpen = () => !!overlay() && !overlay().classList.contains("hidden");

function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const p = m[1].split(",").map((x) => parseFloat(x));
  return [p[0], p[1], p[2]].map((v) => Math.round(v));
}

function nearestSchool(rgb) {
  let best = DEFAULT_SCHOOL, bestD = Infinity;
  for (const sc of SCHOOLS) {
    const d = (sc.rgb[0] - rgb[0]) ** 2 + (sc.rgb[1] - rgb[1]) ** 2 + (sc.rgb[2] - rgb[2]) ** 2;
    if (d < bestD) { bestD = d; best = sc; }
  }
  return best;
}

// Resolve a school for a spell card: data-school attr wins, else infer from the
// .dsc-swatch computed background, else fall back to --arcane.
function schoolForCard(card) {
  const attr = card.dataset.school;
  if (attr) {
    const found = SCHOOLS.find((s) => s.id === attr);
    if (found) return found;
  }
  const sw = card.querySelector(".dsc-swatch");
  if (sw) {
    const rgb = parseColor(getComputedStyle(sw).backgroundColor);
    if (rgb) return nearestSchool(rgb);
  }
  return DEFAULT_SCHOOL;
}

// Resolve a school for a filled pip from its --swatch hex (set by ui.js).
function schoolForPip(pip) {
  const rgb = parseColor(pip.style.getPropertyValue("--swatch"));
  return rgb ? nearestSchool(rgb) : DEFAULT_SCHOOL;
}

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
.draft-spell-card[data-dj-school]:hover:not(:disabled):not(.at-cap),
.draft-spell-card[data-dj-school]:focus-visible {
  border-color: var(--dj-glow, var(--arcane));
  box-shadow: 0 0 0 1px var(--dj-glow, var(--arcane)), 0 0 22px -3px var(--dj-glow, var(--arcane));
}
@keyframes djLockIn {
  0%   { transform: scale(1); filter: brightness(1); }
  35%  { transform: scale(1.22); filter: brightness(1.35); }
  100% { transform: scale(1); filter: brightness(1); }
}
.draft-slot-pip.dj-lock { animation: djLockIn 0.42s ${EASE} 1; }
@keyframes djAllLocked {
  0%   { box-shadow: 0 0 0 rgba(108,76,255,0); }
  45%  { box-shadow: 0 0 50px rgba(108,76,255,0.6); }
  100% { box-shadow: 0 0 18px -8px rgba(108,76,255,0.45); }
}
.draft-panel.dj-alllocked { animation: djAllLocked 0.7s ease 1; }
@media (prefers-reduced-motion: reduce) {
  .draft-slot-pip.dj-lock,
  .draft-panel.dj-alllocked { animation: none !important; }
}
`;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

// ---- Hover / focus glow + cue (event-delegated on the grid) ----
let lastHover = 0;
function onCardInteract(e) {
  const card = e.target instanceof Element ? e.target.closest(".draft-spell-card") : null;
  if (!card || card.disabled) return;
  if (!isOpen()) return;
  if (!card.dataset.djResolved) {
    const sc = schoolForCard(card);
    card.style.setProperty("--dj-glow", `var(--${sc.id})`);
    card.setAttribute("data-dj-school", sc.id);
    card.dataset.djResolved = "1";
  }
  const now = performance.now();
  if (now - lastHover > 60) { lastHover = now; menuCue("hover"); }
}

// ---- Lock-in detection: MutationObserver on .draft-slot-pip class changes ----
function onPipMutation(mutations) {
  if (!isOpen()) return;
  for (const m of mutations) {
    const pip = m.target;
    if (!(pip instanceof Element) || !pip.classList.contains("draft-slot-pip")) continue;
    if (!pip.classList.contains("draft-slot-filled")) {
      // Cleared — allow a re-fill to celebrate again.
      if (pip.dataset.djLocked) delete pip.dataset.djLocked;
      continue;
    }
    if (pip.dataset.djLocked === "1") continue;
    pip.dataset.djLocked = "1";
    fireLockIn(pip);
  }
  checkAllFilled();
}

function fireLockIn(pip) {
  const sc = schoolForPip(pip);
  const c = centerOf(pip);
  FX.burst(c.x, c.y, sc.burst, 10); // FX self-skips under reduced motion
  menuCue("lockin");
  pip.classList.remove("dj-lock");
  void pip.offsetWidth;
  pip.classList.add("dj-lock");
  pip.addEventListener("animationend", () => pip.classList.remove("dj-lock"), { once: true });
}

let wasAllFilled = false;
function checkAllFilled() {
  const slots = $("draft-slots");
  if (!slots) return;
  const pips = slots.querySelectorAll(".draft-slot-pip");
  let filled = 0;
  pips.forEach((p) => { if (p.classList.contains("draft-slot-filled")) filled++; });
  const all = pips.length > 0 && filled === pips.length;
  if (all && !wasAllFilled) celebrate();
  wasAllFilled = all;
}

function celebrate() {
  const panel = document.querySelector(".draft-panel");
  if (panel) {
    panel.classList.remove("dj-alllocked");
    void panel.offsetWidth;
    panel.classList.add("dj-alllocked");
    panel.addEventListener("animationend", () => panel.classList.remove("dj-alllocked"), { once: true });
  }
  FX.flash("rgba(108,76,255,0.5)"); // degrades gracefully under reduced motion
  menuCue("confirm");
  setTimeout(() => menuCue("lockin"), 130);
}

// ---- Countdown: watch #draft-timer textContent, tick each second ≤5s ----
let lastCountSec = -1;
function onTimerMutation() {
  if (!isOpen()) return;
  const sec = parseInt($("draft-timer")?.textContent || "", 10);
  if (!Number.isFinite(sec) || sec === lastCountSec) return;
  lastCountSec = sec;
  if (sec > 0 && sec <= 5) menuCue("countdown");
}

// ---- Lifecycle: reset transient state when the overlay hides ----
function onOverlayVisibility() {
  if (isOpen()) return;
  lastCountSec = -1;
  wasAllFilled = false;
  document.querySelectorAll(".draft-slot-pip[data-dj-locked]").forEach((p) => { delete p.dataset.djLocked; });
  const panel = document.querySelector(".draft-panel");
  if (panel) panel.classList.remove("dj-alllocked");
}

function init() {
  injectStyle();
  const grid = $("draft-grid");
  if (grid) {
    grid.addEventListener("mouseover", onCardInteract);
    grid.addEventListener("focusin", onCardInteract);
  }
  const slots = $("draft-slots");
  if (slots) new MutationObserver(onPipMutation).observe(slots, { subtree: true, attributes: true, attributeFilter: ["class"] });
  const timer = $("draft-timer");
  if (timer) new MutationObserver(onTimerMutation).observe(timer, { childList: true, characterData: true, subtree: true });
  const ov = overlay();
  if (ov) new MutationObserver(onOverlayVisibility).observe(ov, { attributes: true, attributeFilter: ["class"] });
}

if (document.readyState !== "loading") init();
else document.addEventListener("DOMContentLoaded", init, { once: true });
