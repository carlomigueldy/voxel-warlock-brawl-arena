// Draft-juice "school" table — port of src/draft-juice.js's SCHOOLS +
// nearestSchool(). Legacy resolves a spell's school by parsing the computed
// CSS color of its rendered swatch (it only observes the DOM, no access to
// source data); React owns the data directly, so this ports the same table
// and nearest-color matching straight from `SPELLS[id].color` — no DOM
// parsing, no MutationObserver, per design §9's "stop observing the DOM".
import { SPELLS } from "../../config.js";
import type { FxParticleKind } from "../../hooks/useFx";

export interface DraftSchool {
  /** Token name (var(--<id>)) — also the tokens.css custom property key. */
  id: "ember" | "arcane" | "rune" | "gold" | "pink" | "cyan";
  rgb: readonly [number, number, number];
  burst: FxParticleKind;
}

const SCHOOLS: readonly DraftSchool[] = [
  { id: "ember", rgb: [255, 90, 60], burst: "ember" },
  { id: "arcane", rgb: [108, 76, 255], burst: "rune" },
  { id: "rune", rgb: [124, 255, 90], burst: "rune" },
  { id: "gold", rgb: [255, 210, 60], burst: "spark" },
  { id: "pink", rgb: [255, 76, 168], burst: "confetti" },
  { id: "cyan", rgb: [76, 201, 255], burst: "shard" },
];
const DEFAULT_SCHOOL = SCHOOLS[1]; // arcane

function unpack(color: number): [number, number, number] {
  return [(color >>> 16) & 255, (color >>> 8) & 255, color & 255];
}

function nearestSchool(rgb: readonly [number, number, number]): DraftSchool {
  let best = DEFAULT_SCHOOL;
  let bestD = Infinity;
  for (const sc of SCHOOLS) {
    const d = (sc.rgb[0] - rgb[0]) ** 2 + (sc.rgb[1] - rgb[1]) ** 2 + (sc.rgb[2] - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = sc;
    }
  }
  return best;
}

/** Resolve the draft-juice school for a spell id, falling back to arcane for
 * an unknown id (mirrors draft-juice.js's DEFAULT_SCHOOL fallback). */
export function schoolForSpell(id: string): DraftSchool {
  const def = SPELLS[id];
  if (!def) return DEFAULT_SCHOOL;
  return nearestSchool(unpack(def.color ?? 0x6c4cff));
}
