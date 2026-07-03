// React port of src/fx.js's "Juice & FX" layer — full-viewport flash,
// vignette pulse, chromatic aberration, screen shake, particle bursts, and a
// tiny event bus for 3D-stage moments (design §4). Kept as a MODULE-LEVEL
// singleton (not per-component state), exactly like fx.js was — every P5
// surface (HUD damage flash, victory/defeat stage cues, draft juice, ...)
// must share the SAME #fx-layer host + --shake-amp/--aberration-offset
// custom properties that styles/fx.css's keyframes read, so there can only
// ever be one of these regardless of how many components call useFx(). The
// hook just hands back a stable reference to that singleton so call sites
// stay hook-idiomatic; non-component code can `import { FX }` directly, same
// as fx.js was imported before.
//
// Every motion method degrades (flash) or early-returns (everything else)
// when the user prefers reduced motion; particles are skipped entirely —
// same contract as fx.js (design §7's "reduced motion respected").
const FX_LAYER_ID = "fx-layer";

export type FxParticleKind = "ember" | "shard" | "spark" | "confetti" | "rune";
export type FxStageEvent = "victory" | "defeat" | "idle";
export type FxStageCallback = (opts?: unknown) => void;

const PARTICLE_KINDS: Record<FxParticleKind, { cls: string; anim: string }> = {
  ember: { cls: "fx-particle--ember", anim: "fx-particle-ember" },
  shard: { cls: "fx-particle--shard", anim: "fx-particle-shard" },
  spark: { cls: "fx-particle--spark", anim: "fx-particle-spark" },
  confetti: { cls: "fx-particle--confetti", anim: "fx-particle-confetti" },
  rune: { cls: "fx-particle--rune", anim: "fx-particle-rune" },
};

const CONFETTI_COLORS = ["var(--ember)", "var(--arcane)", "var(--rune)", "var(--gold)", "var(--pink)", "var(--cyan)"];

const STAGE_EVENTS: ReadonlySet<FxStageEvent> = new Set(["victory", "defeat", "idle"]);

// jsdom (this repo's test environment for DOM-touching specs) does not
// implement matchMedia — guard the same way renderer.js/ui.js already do
// (`window.matchMedia?.(...)`) so importing this module never throws outside
// a browser, and reducedMotion just stays false where the API is absent.
const mq: MediaQueryList | null =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

const stage = new Map<FxStageEvent, Set<FxStageCallback>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function layer(): HTMLElement {
  let el = document.getElementById(FX_LAYER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = FX_LAYER_ID;
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  return el;
}

function shakeTarget(): HTMLElement {
  return document.getElementById("app") || document.body;
}

function runClass(el: HTMLElement, cls: string, ms: number): void {
  const prev = timers.get(cls);
  if (prev) clearTimeout(prev);
  el.classList.remove(cls);
  void el.offsetWidth; // restart the CSS animation even if `cls` is already applied
  el.classList.add(cls);
  timers.set(
    cls,
    setTimeout(() => {
      el.classList.remove(cls);
      timers.delete(cls);
    }, ms),
  );
}

export interface FxApi {
  reducedMotion: boolean;
  flash(color?: string, ms?: number): void;
  vignette(color?: string, ms?: number): void;
  aberration(ms?: number): void;
  shake(amp?: number, ms?: number): void;
  burst(x: number, y: number, kind?: FxParticleKind, n?: number): void;
  onStage(event: FxStageEvent, cb: FxStageCallback): () => void;
  emitStage(event: FxStageEvent, opts?: unknown): void;
}

export const FX: FxApi = {
  reducedMotion: mq?.matches ?? false,

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
      const dx = Math.cos(angle) * speed;
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
      const cleanup = () => {
        p.remove();
      };
      p.addEventListener("animationend", cleanup, { once: true });
      setTimeout(cleanup, dur + 200);
    }
  },

  onStage(event, cb) {
    if (!STAGE_EVENTS.has(event) || typeof cb !== "function") return () => {};
    if (!stage.has(event)) stage.set(event, new Set());
    const set = stage.get(event)!;
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
      try {
        cb(opts);
      } catch {
        // a bad listener must not break the others (mirrors fx.js)
      }
    }
  },
};

mq?.addEventListener("change", (e) => {
  FX.reducedMotion = e.matches;
});

/** Hook form — `const fx = useFx()` inside components, kept hook-idiomatic
 * for call-site consistency with the rest of P5. FX is already a stable
 * module-level singleton, so this is just a typed re-export, not state. */
export function useFx(): FxApi {
  return FX;
}
