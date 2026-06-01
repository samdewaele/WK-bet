/**
 * Validates the TEAMS constant in prisma/seed.ts.
 * These are pure data checks — no DB required.
 * Catches regressions like wrong group counts, duplicate teams, or bad group letters.
 */
import { describe, it, expect } from "vitest";

// Re-export TEAMS from seed.ts by reading it as a module.
// seed.ts uses a top-level async main(), so we import just the constant.
import { TEAMS } from "../prisma/seed";

const VALID_GROUPS = ["A","B","C","D","E","F","G","H","I","J","K","L"] as const;

describe("TEAMS seed data", () => {
  it("has exactly 48 teams", () => {
    expect(TEAMS).toHaveLength(48);
  });

  it("has exactly 12 groups (A–L)", () => {
    const groups = new Set(TEAMS.map((t) => t.group));
    expect([...groups].sort()).toEqual([...VALID_GROUPS]);
  });

  it("has exactly 4 teams in every group", () => {
    for (const g of VALID_GROUPS) {
      const count = TEAMS.filter((t) => t.group === g).length;
      expect(count, `Group ${g} should have 4 teams, got ${count}`).toBe(4);
    }
  });

  it("has no duplicate team names", () => {
    const names = TEAMS.map((t) => t.name);
    const unique = new Set(names);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `Duplicate team names: ${dupes.join(", ")}`).toHaveLength(0);
  });

  it("every team has a non-empty name, flag, and valid group", () => {
    for (const t of TEAMS) {
      expect(t.name.trim(), "empty name").not.toBe("");
      expect(t.flag.trim(), `${t.name}: empty flag`).not.toBe("");
      expect(VALID_GROUPS as readonly string[], `${t.name}: invalid group`).toContain(t.group);
    }
  });

  // Spot-check a few well-known placements from the official draw
  const cases: [string, string][] = [
    ["Mexico",           "A"],
    ["Canada",           "B"],
    ["Brazil",           "C"],
    ["United States",    "D"],
    ["Germany",          "E"],
    ["Netherlands",      "F"],
    ["Belgium",          "G"],
    ["Spain",            "H"],
    ["France",           "I"],
    ["Argentina",        "J"],
    ["Portugal",         "K"],
    ["England",          "L"],
  ];

  it.each(cases)("%s is in Group %s", (name, group) => {
    const team = TEAMS.find((t) => t.name === name);
    expect(team, `${name} not found in TEAMS`).toBeDefined();
    expect(team!.group).toBe(group);
  });
});
