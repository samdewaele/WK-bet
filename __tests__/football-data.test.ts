import { describe, it, expect } from "vitest";
import { mapStatus } from "@/lib/football-data";

describe("mapStatus", () => {
  it.each([
    ["IN_PLAY",  "live"],
    ["PAUSED",   "live"],
    ["HALFTIME", "live"],
  ] as const)("maps %s → live", (input, expected) => {
    expect(mapStatus(input)).toBe(expected);
  });

  it("maps FINISHED → finished", () => {
    expect(mapStatus("FINISHED")).toBe("finished");
  });

  it.each([
    ["SCHEDULED"],
    ["TIMED"],
    ["POSTPONED"],
    ["CANCELLED"],
    ["SUSPENDED"],
  ] as const)("maps %s → scheduled", (input) => {
    expect(mapStatus(input)).toBe("scheduled");
  });

  it("live statuses are distinct from finished", () => {
    expect(mapStatus("IN_PLAY")).not.toBe("finished");
    expect(mapStatus("PAUSED")).not.toBe("finished");
  });

  it("finished is distinct from live", () => {
    expect(mapStatus("FINISHED")).not.toBe("live");
  });
});
