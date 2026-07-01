// Credits screen — a dedicated spine nav entry and self-contained sub-screen.
// All markup and styles are injected at runtime so no host files change.
// The built-in UI._bindNavSpine() has already run by the time this module
// evaluates, so the late-injected spine button gets its own click handler that
// mirrors _showMenuScreen's show/hide logic.
import { FX } from "./fx.js";
import { menuCue } from "./audio.js";

const SCREEN_ID = "screen-credits";
const SCREEN_KEY = "credits";

function injectStyles() {
  if (document.getElementById("credits-styles")) return;
  const style = document.createElement("style");
  style.id = "credits-styles";
  style.textContent = `
#screen-credits { max-width: 560px; }

.credits-wrap {
  position: relative;
  height: clamp(280px, 52vh, 460px);
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 20px;
  box-shadow: var(--shadow-panel);
  background:
    linear-gradient(180deg, rgba(40,32,78,0.92), rgba(15,11,33,0.96)),
    linear-gradient(rgba(108,76,255,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(108,76,255,0.05) 1px, transparent 1px);
  background-size: auto, 44px 44px, 44px 44px;
}
.credits-wrap::before {
  content: ""; position: absolute; inset: 0; border-radius: 20px; pointer-events: none;
  box-shadow: var(--bezel);
}
.credits-wrap::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: 20px;
  background: linear-gradient(180deg, rgba(10,8,20,0.55) 0%, transparent 14%, transparent 86%, rgba(10,8,20,0.55) 100%);
}

.credits-scroll {
  position: relative;
  padding: 48px 32px;
  display: flex; flex-direction: column; gap: 40px; align-items: center;
  text-align: center;
  animation: crScroll 32s linear infinite;
  will-change: transform;
}
.credits-wrap:hover .credits-scroll { animation-play-state: paused; }

@keyframes crScroll {
  from { transform: translateY(100%); }
  to   { transform: translateY(-100%); }
}

.credits-section { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.credits-h {
  font-family: var(--font-display);
  font-size: 12px; letter-spacing: 3px;
  color: var(--gold);
  text-shadow: 0 0 14px rgba(255,210,60,0.4);
}
.credits-body {
  font-family: var(--font-ui);
  font-size: 15px; line-height: 1.7;
  color: var(--text);
  max-width: 420px;
}
.credits-link {
  color: var(--gold); text-decoration: none; font-weight: 700;
  transition: opacity 0.18s ease;
}
.credits-link:hover { opacity: 0.85; text-decoration: underline; }
.credits-link:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; border-radius: 3px; }

@media (max-width: 800px) {
  .credits-wrap { height: clamp(240px, 44vh, 380px); }
}

@media (prefers-reduced-motion: reduce) {
  #screen-credits .credits-wrap { overflow-y: auto; }
  #screen-credits .credits-scroll { animation: none !important; transform: none !important; }
}
`;
  document.head.appendChild(style);
}

function buildSpineButton() {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.className = "spine-btn";
  btn.dataset.screen = SCREEN_KEY;
  btn.setAttribute("aria-current", "false");
  btn.innerHTML = `<span class="spine-icon" aria-hidden="true">★</span><span>CREDITS</span>`;
  li.appendChild(btn);
  return { li, btn };
}

function buildScreen() {
  const el = document.createElement("div");
  el.className = "sub-screen sub-screen-hidden";
  el.id = SCREEN_ID;
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Credits");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <h2 class="sub-screen-title">CREDITS</h2>
    <div class="credits-wrap">
      <div class="credits-scroll">
        <section class="credits-section">
          <h3 class="credits-h">CRAFTED BY</h3>
          <p class="credits-body"><a class="credits-link" href="https://carlomigueldy.dev" target="_blank" rel="noopener noreferrer">carlomigueldy.dev</a></p>
        </section>
        <section class="credits-section">
          <h3 class="credits-h">POWERED BY</h3>
          <p class="credits-body">Three.js · PeerJS (WebRTC) · Supabase · qrcode · Meshy AI</p>
        </section>
        <section class="credits-section">
          <h3 class="credits-h">SPELL ICONS</h3>
          <p class="credits-body">Bespoke duotone SVG icons</p>
        </section>
        <section class="credits-section">
          <h3 class="credits-h">SPECIAL THANKS</h3>
          <p class="credits-body">The Warlock Brawl (Warcraft III) original that inspired this clone</p>
        </section>
      </div>
    </div>
  `;
  return el;
}

// Mirror of UI._showMenuScreen: toggle every sub-screen + spine button so the
// dynamically injected credits entry stays in sync with the built-in nav.
function showScreen(name) {
  const menu = document.getElementById("menu");
  if (!menu) return;
  menu.querySelectorAll(".sub-screen").forEach((s) => {
    const on = s.id === `screen-${name}`;
    s.classList.toggle("sub-screen-hidden", !on);
    s.setAttribute("aria-hidden", on ? "false" : "true");
  });
  menu.querySelectorAll(".spine-btn").forEach((b) => {
    const on = b.dataset.screen === name;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-current", on ? "true" : "false");
  });
}

function init() {
  injectStyles();

  const spineNav = document.querySelector(".spine-nav");
  const menuRight = document.querySelector(".menu-right");
  if (!spineNav || !menuRight) return;

  const { li, btn } = buildSpineButton();
  spineNav.appendChild(li);

  const screen = buildScreen();
  menuRight.appendChild(screen);

  // Under reduced motion the auto-scroll is disabled (see @media above); make
  // the viewport keyboard-focusable so users can scroll it with arrow keys.
  const wrap = screen.querySelector(".credits-wrap");
  if (FX.reducedMotion) wrap.setAttribute("tabindex", "0");

  // The built-in _bindNavSpine() ran before this module, so it never wired
  // this late-injected button — wire it ourselves, mirroring _showMenuScreen.
  btn.addEventListener("click", () => {
    showScreen(SCREEN_KEY);
    menuCue("confirm");
  });

  // Downgrade the footer credit link into a secondary trigger for this screen.
  const footerLink = document.querySelector(".author-credit a");
  if (footerLink) {
    footerLink.setAttribute("role", "button");
    footerLink.setAttribute("aria-label", "Open credits");
    footerLink.addEventListener("click", (e) => {
      e.preventDefault();
      showScreen(SCREEN_KEY);
      btn.focus();
      menuCue("confirm");
    });
  }

  // ESC/back returns to the default (online) sub-screen when credits is open.
  // No-op unless the menu is visible AND credits is the active sub-screen, so
  // it never clashes with nav-feel's back logic or the in-game pause/draft ESC.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const menu = document.getElementById("menu");
    if (!menu || menu.classList.contains("hidden")) return;
    const credits = document.getElementById(SCREEN_ID);
    if (!credits || credits.classList.contains("sub-screen-hidden")) return;
    showScreen("online");
    menuCue("back");
  });
}

init();
