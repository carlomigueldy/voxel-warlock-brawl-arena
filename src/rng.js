// Shared seeded PRNG used by sim.js and bot.js.
// Mulberry32 — fast, seedable, good statistical quality for game use.

/** FNV-1a hash of a string → unsigned 32-bit seed. */
export function idSeed(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mulberry32 PRNG factory.
 * Returns a zero-argument function that yields floats in [0, 1).
 */
export function makePrng(seed) {
  let s = seed >>> 0;
  return function next() {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
