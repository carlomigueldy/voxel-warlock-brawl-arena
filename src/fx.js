// Unified "Juice & FX" layer: full-viewport flash, vignette pulse, chromatic
// aberration, screen shake, particle bursts, and a tiny event bus for 3D-stage
// moments. The #fx-layer host is created lazily on first use so index.html
// markup stays optional. Every motion method degrades (flash) or early-returns
// (everything else) when the user prefers reduced motion; particles are skipped
// entirely under reduced motion.

const FX_LAYER_ID = "fx-layer";

const PARTICLE_KINDS = {
  ember:    { cls: "fx-particle--ember",    anim: "fx-particle-ember" },
  shard:    { cls: "fx-particle--shard",    anim: "fx-particle-shard" },
  spark:    { cls: "fx-particle--spark",    anim: "fx-particle-spark" },
  confetti: { cls: "fx-particle--confetti", anim: "fx-particle-confetti" },
  rune:     { cls: "fx-particle--rune",     anim: "fx-particle-rune" },
};

const CONFETTI_COLORS = [
  "var(--ember)", "var(--arcane)", "var(--rune)",
  "var(--gold)", "var(--pink)", "var(--cyan)",
];

const STAGE_EVENTS = new Set(["victory", "defeat", "idle"]);

const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
const stage = new Map();
const timers = new Map();

function layer() {
  let el = document.getElementById(FX_LAYER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = FX_LAYER_ID;
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  return el;
}

function shakeTarget() {
  return document.getElementById("app") || document.body;
}

function runClass(el, cls, ms) {
  const prev = timers.get(cls);
  if (prev) clearTimeout(prev);
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  timers.set(cls, setTimeout(() => {
    el.classList.remove(cls);
    timers.delete(cls);
  }, ms));
}

export const FX = {
  reducedMotion: mq.matches,

  flash(color, ms = 160) {
    const el = layer();
    el.style.setProperty("--fx-flash-color", color || "rgba(255,255,255,0.4)");
    el.style.setProperty("--fx-flash-ms", ms + "ms");
    runClass(el, "fx-flash", ms);
  },

  vignette(color, ms = 300) {
    if (this.reducedMotion) return;
    const el = layer();
    el.style.setProperty("--fx-vignette-color", color || "var(--fx-vignette-lowhp)");
    el.style.setProperty("--fx-vignette-ms", ms + "ms");
    runClass(el, "fx-vignette", ms);
  },

  aberration(ms = 300) {
    if (this.reducedMotion) return;
    const el = layer();
    el.style.setProperty("--aberration-offset", "4px");
    el.style.setProperty("--fx-aberration-ms", ms + "ms");
    runClass(el, "fx-aberration", ms);
  },

  shake(amp = 6, ms = 300) {
    if (this.reducedMotion) return;
    const el = shakeTarget();
    el.style.setProperty("--shake-amp", amp + "px");
    el.style.setProperty("--shake-ms", ms + "ms");
    runClass(el, "fx-shake", ms);
  },

  burst(x, y, kind = "ember", n = 12) {
    if (this.reducedMotion) return;
    const def = PARTICLE_KINDS[kind] || PARTICLE_KINDS.ember;
    const el = layer();
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "fx-particle " + def.cls;
      p.style.left = x + "px";
      p.style.top = y + "px";
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 90;
      let dx = Math.cos(angle) * speed;
      let dy = Math.sin(angle) * speed;
      if (kind === "ember") dy = -Math.abs(dy) - 30;
      else if (kind === "confetti") dy = Math.abs(dy) + 40;
      const rot = Math.random() * 720 - 360;
      const dur = 600 + Math.random() * 600;
      p.style.setProperty("--dx", dx + "px");
      p.style.setProperty("--dy", dy + "px");
      p.style.setProperty("--rot", rot + "deg");
      p.style.animation = def.anim + " " + dur + "ms ease-out both";
      if (kind === "confetti") {
        const c = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        p.style.background = c;
        p.style.boxShadow = "0 0 4px " + c;
      }
      el.appendChild(p);
      const cleanup = () => { p.remove(); };
      p.addEventListener("animationend", cleanup, { once: true });
      setTimeout(cleanup, dur + 200);
    }
  },

  onStage(event, cb) {
    if (!STAGE_EVENTS.has(event) || typeof cb !== "function") return () => {};
    if (!stage.has(event)) stage.set(event, new Set());
    const set = stage.get(event);
    set.add(cb);
    return () => {
      const s = stage.get(event);
      if (s) s.delete(cb);
    };
  },

  emitStage(event, opts) {
    const set = stage.get(event);
    if (!set) return;
    for (const cb of set) {
      try { cb(opts); } catch {}
    }
  },
};

mq.addEventListener("change", (e) => { FX.reducedMotion = e.matches; });
