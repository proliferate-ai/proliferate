import type { RuntimeResourcePressure } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  cloudPressureLimitPercent,
  pressureProgressPercent,
  pressureTone,
} from "./runtime-pressure-threshold";

describe("runtime pressure threshold", () => {
  it("uses disk threshold pressure to drive the existing destructive affordance", () => {
    const resourcePressure: RuntimeResourcePressure = {
      collectedAt: "2026-07-01T00:00:00Z",
      level: "critical",
      pressurePercent: 84,
      disk: {
        percent: 84,
        availableBytes: 16 * 1024 ** 3,
        totalBytes: 100 * 1024 ** 3,
        usedBytes: 84 * 1024 ** 3,
        idealMaxPercent: 80,
      },
    };
    const pressureLimitPercent = cloudPressureLimitPercent(resourcePressure);
    const pressurePercent = resourcePressure.pressurePercent ?? null;

    expect(pressureLimitPercent).toBe(80);
    expect(pressureTone(pressurePercent, pressureLimitPercent)).toBe("destructive");
    expect(pressureProgressPercent(pressurePercent, pressureLimitPercent)).toBe(100);
  });
});
