// Unit coverage for the draft-juice school table (port of
// src/draft-juice.js's SCHOOLS/nearestSchool — see the module header for why
// this resolves from SPELLS[id].color directly instead of parsing DOM CSS).
import { describe, it, expect } from "vitest";
import { schoolForSpell } from "./draftSchools";

describe("schoolForSpell", () => {
  it("resolves fireball (0xff5a1e) to the ember school", () => {
    expect(schoolForSpell("fireball").id).toBe("ember");
  });

  it("resolves lightning (0x9fe6ff, closest to cyan) to the cyan school", () => {
    expect(schoolForSpell("lightning").id).toBe("cyan");
  });

  it("falls back to arcane for an unknown spell id", () => {
    expect(schoolForSpell("not-a-real-spell").id).toBe("arcane");
  });

  it("every school maps to a valid FxParticleKind burst", () => {
    const validKinds = new Set(["ember", "shard", "spark", "confetti", "rune"]);
    for (const id of ["fireball", "lightning", "meteor", "windWalk", "summon"]) {
      expect(validKinds.has(schoolForSpell(id).burst)).toBe(true);
    }
  });
});
