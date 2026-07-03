// Pure fixed-timestep accumulator — extracted verbatim from main.js's
// hostLoop (lines 362-380 of the pre-P3a build): clamp the frame delta to
// 100ms (so a tab-backgrounding stall doesn't fire a huge catch-up burst),
// accumulate it, and drain whole ticks at CFG.TICK_RATE. No DOM/rAF/sim
// dependency, so it is node-testable and reused unchanged by useHostLoop —
// see design §6.1 / §8(d) replay-parity.
export interface AccumulatorResult {
  /** Number of whole ticks to step this frame. */
  n: number;
  /** Fixed dt (seconds) each of those `n` steps should use. */
  stepDt: number;
}

export interface Accumulator {
  steps(now: number): AccumulatorResult;
  reset(): void;
}

export function makeAccumulator(tickRate: number): Accumulator {
  const tickMs = 1000 / tickRate;
  let acc = 0;
  let last = performance.now();
  return {
    steps(now: number): AccumulatorResult {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      let n = 0;
      while (acc >= tickMs / 1000) {
        acc -= tickMs / 1000;
        n++;
      }
      return { n, stepDt: tickMs / 1000 };
    },
    reset(): void {
      acc = 0;
      last = performance.now();
    },
  };
}
