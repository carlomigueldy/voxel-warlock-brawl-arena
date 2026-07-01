// Keyboard + back navigation for the menu spine and sub-screens.
// Self-contained: event delegation + MutationObserver only. Does not edit ui.js/main.js.
import { FX } from './fx.js';
import { menuCue } from './audio.js';

const DEFAULT_SCREEN = 'online';

const transitionDecl = FX.reducedMotion
  ? ''
  : 'transition: opacity .18s ease, transform .18s ease, background .15s ease, border-color .15s ease;';

const CSS = `
.nav-back {
  position: absolute; top: 14px; left: 14px; z-index: 6;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px 6px 9px;
  font-family: var(--font-body, inherit);
  font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--text, #e8e2f0);
  background: rgba(20, 14, 30, 0.72);
  border: 1px solid rgba(255, 90, 60, 0.35);
  border-radius: 10px;
  cursor: pointer;
  opacity: 0; transform: translateX(-6px); pointer-events: none;
  ${transitionDecl}
}
.nav-back.is-visible { opacity: 1; transform: none; pointer-events: auto; }
.nav-back:hover { background: rgba(255, 90, 60, 0.14); border-color: var(--ember, #ff5a3c); }
.nav-back:focus-visible { outline: 2px solid var(--ember, #ff5a3c); outline-offset: 2px; }
.nav-back:active { transform: scale(.96); }
@media (prefers-reduced-motion: reduce) {
  .nav-back, .nav-back.is-visible, .nav-back:active { transition: none; transform: none; }
}
`;

const $ = (id) => document.getElementById(id);
const q = (sel, root = document) => root.querySelector(sel);
const spineNav = () => q('.spine-nav');
const spineButtons = () => [...document.querySelectorAll('.spine-btn')];
const isActive = (btn) => btn.classList.contains('is-active') || btn.getAttribute('aria-current') === 'true';

function currentScreen() {
  const active = spineButtons().find(isActive);
  return active ? active.dataset.screen : null;
}

function spineButton(screen) {
  return spineButtons().find((b) => b.dataset.screen === screen) || null;
}

function syncState() {
  const btns = spineButtons();
  btns.forEach((b) => {
    b.setAttribute('role', 'tab');
    b.tabIndex = isActive(b) ? 0 : -1;
  });
  const back = q('.nav-back');
  if (back) {
    const visible = currentScreen() !== DEFAULT_SCREEN;
    back.classList.toggle('is-visible', visible);
    back.tabIndex = visible ? 0 : -1;
    back.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }
}

function setupSpineA11y() {
  const nav = spineNav();
  if (nav && nav.getAttribute('role') !== 'tablist') nav.setAttribute('role', 'tablist');
  spineButtons().forEach((b) => b.setAttribute('role', 'tab'));
}

function setupSpineKeys() {
  const root = q('.menu-spine');
  if (!root) return;
  root.addEventListener('keydown', (e) => {
    const btns = spineButtons();
    const n = btns.length;
    if (!n) return;
    const target = e.target.closest ? e.target.closest('.spine-btn') : null;
    const i = btns.indexOf(target);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    const dest = btns[next];
    dest.click();
    dest.focus();
    menuCue('hover');
  });
}

function overlaysClosed() {
  const draft = $('#spell-draft');
  const pause = $('#pause-menu');
  return (!draft || draft.classList.contains('hidden')) &&
         (!pause || pause.classList.contains('hidden'));
}

function backToDefault() {
  const btn = spineButton(DEFAULT_SCREEN);
  if (btn) btn.click();
}

function setupEscBack() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const menu = $('#menu');
    const lobby = $('#lobby');
    const inMenu = !!menu && !menu.classList.contains('hidden');
    const inLobby = !!lobby && !lobby.classList.contains('hidden');
    if (!inMenu && !inLobby) return;
    if (!overlaysClosed()) return;
    if (inLobby) {
      menuCue('back');
      document.dispatchEvent(new CustomEvent('nav:back', { detail: { from: 'lobby' } }));
      return;
    }
    const screen = currentScreen();
    if (screen && screen !== DEFAULT_SCREEN) {
      menuCue('back');
      backToDefault();
    }
  });
}

function injectBackButton() {
  const host = q('.menu-right');
  if (!host || q('.nav-back')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-back';
  btn.setAttribute('aria-label', 'Back to Online play');
  btn.tabIndex = -1;
  btn.setAttribute('aria-hidden', 'true');
  btn.textContent = '‹ BACK';
  btn.addEventListener('click', () => {
    menuCue('back');
    backToDefault();
  });
  host.prepend(btn);
}

function observeState() {
  const nav = spineNav();
  if (!nav || typeof MutationObserver === 'undefined') return;
  const obs = new MutationObserver(() => syncState());
  obs.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-current'] });
}

function init() {
  if (!q('.menu-spine')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  setupSpineA11y();
  setupSpineKeys();
  injectBackButton();
  setupEscBack();
  observeState();
  syncState();
}

init();
