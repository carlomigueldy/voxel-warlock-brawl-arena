// @vitest-environment jsdom
// Unit coverage for the useFx port of src/fx.js (design §4) — the
// setProperty mechanism, class toggling, reduced-motion gating, and the
// onStage/emitStage event bus.
import { describe, it, expect, afterEach, vi } from "vitest";
import { FX, useFx } from "./useFx";

afterEach(() => {
  document.getElementById("fx-layer")?.remove();
  document.getElementById("app")?.remove();
  FX.reducedMotion = false;
  vi.restoreAllMocks();
});

describe("useFx", () => {
  it("returns the same stable FX singleton on every call", () => {
    expect(useFx()).toBe(FX);
    expect(useFx()).toBe(useFx());
  });

  it("flash() lazily creates #fx-layer, sets the color/duration custom properties, and toggles fx-flash", () => {
    expect(document.getElementById("fx-layer")).toBeNull();
    FX.flash("rgba(1,2,3,0.5)", 200);
    const el = document.getElementById("fx-layer")!;
    expect(el).not.toBeNull();
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.style.getPropertyValue("--fx-flash-color")).toBe("rgba(1,2,3,0.5)");
    expect(el.style.getPropertyValue("--fx-flash-ms")).toBe("200ms");
    expect(el.classList.contains("fx-flash")).toBe(true);
  });

  it("flash() reuses the existing #fx-layer host instead of creating a second one", () => {
    FX.flash();
    const first = document.getElementById("fx-layer");
    FX.flash();
    const second = document.getElementById("fx-layer");
    expect(first).toBe(second);
    expect(document.querySelectorAll("#fx-layer").length).toBe(1);
  });

  it("vignette()/aberration()/shake()/burst() are no-ops under reduced motion; flash() still fires", () => {
    FX.reducedMotion = true;
    FX.vignette();
    FX.aberration();
    FX.shake();
    FX.burst(0, 0);
    expect(document.getElementById("fx-layer")).toBeNull(); // none of the gated methods touched the DOM

    FX.flash("red", 50);
    expect(document.getElementById("fx-layer")!.classList.contains("fx-flash")).toBe(true);
  });

  it("vignette() sets the color/duration properties and toggles fx-vignette when motion is allowed", () => {
    FX.vignette("var(--fx-vignette-lowhp)", 250);
    const el = document.getElementById("fx-layer")!;
    expect(el.style.getPropertyValue("--fx-vignette-color")).toBe("var(--fx-vignette-lowhp)");
    expect(el.style.getPropertyValue("--fx-vignette-ms")).toBe("250ms");
    expect(el.classList.contains("fx-vignette")).toBe(true);
  });

  it("aberration() sets --aberration-offset and toggles fx-aberration", () => {
    FX.aberration(120);
    const el = document.getElementById("fx-layer")!;
    expect(el.style.getPropertyValue("--aberration-offset")).toBe("4px");
    expect(el.style.getPropertyValue("--fx-aberration-ms")).toBe("120ms");
    expect(el.classList.contains("fx-aberration")).toBe(true);
  });

  it("shake() targets #app (falling back to document.body) and sets --shake-amp/--shake-ms", () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);

    FX.shake(9, 400);
    expect(app.style.getPropertyValue("--shake-amp")).toBe("9px");
    expect(app.style.getPropertyValue("--shake-ms")).toBe("400ms");
    expect(app.classList.contains("fx-shake")).toBe(true);
  });

  it("burst() spawns `n` .fx-particle children of the given kind positioned at (x, y)", () => {
    FX.burst(12, 34, "rune", 5);
    const particles = document.querySelectorAll("#fx-layer .fx-particle--rune");
    expect(particles.length).toBe(5);
    const first = particles[0] as HTMLElement;
    expect(first.style.left).toBe("12px");
    expect(first.style.top).toBe("34px");
    expect(first.style.animation).toContain("fx-particle-rune");
  });

  it("burst() defaults to the ember kind and n=12 particles", () => {
    FX.burst(0, 0);
    expect(document.querySelectorAll("#fx-layer .fx-particle--ember").length).toBe(12);
  });

  it("onStage/emitStage: subscribers for the matching event fire with opts; unsubscribe stops delivery", () => {
    const received: unknown[] = [];
    const unsub = FX.onStage("victory", (opts) => received.push(opts));

    FX.emitStage("victory", { winner: "p1" });
    expect(received).toEqual([{ winner: "p1" }]);

    unsub();
    FX.emitStage("victory", { winner: "p2" });
    expect(received).toEqual([{ winner: "p1" }]); // no further delivery after unsubscribe
  });

  it("emitStage() on an event with no subscribers is a no-op (does not throw)", () => {
    expect(() => FX.emitStage("idle")).not.toThrow();
  });

  it("onStage() rejects unknown event names / non-function callbacks, returning a no-op unsubscribe", () => {
    // @ts-expect-error — exercising the runtime guard against a bad event name
    const unsub1 = FX.onStage("not-a-stage-event", () => {});
    // @ts-expect-error — exercising the runtime guard against a non-function callback
    const unsub2 = FX.onStage("victory", "not-a-function");
    expect(() => unsub1()).not.toThrow();
    expect(() => unsub2()).not.toThrow();
  });

  it("a throwing onStage listener does not prevent sibling listeners from receiving emitStage", () => {
    const received: unknown[] = [];
    const unsubBad = FX.onStage("defeat", () => {
      throw new Error("boom");
    });
    const unsubGood = FX.onStage("defeat", (opts) => received.push(opts));

    expect(() => FX.emitStage("defeat", { loser: "p1" })).not.toThrow();
    expect(received).toEqual([{ loser: "p1" }]);

    unsubBad();
    unsubGood();
  });
});
