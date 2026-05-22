import { describe, expect, it } from "vitest";
import {
  COMPUTE_TARGET_COLOR_IDS,
  defaultComputeTargetColorId,
  defaultComputeTargetIconId,
  normalizeComputeTargetAppearancePreference,
  resolveComputeTargetAppearance,
} from "./target-appearance";

describe("compute target appearance", () => {
  it("chooses stable default colors by target id", () => {
    expect(defaultComputeTargetColorId("target-1")).toBe(
      defaultComputeTargetColorId("target-1"),
    );
    expect(COMPUTE_TARGET_COLOR_IDS).toContain(defaultComputeTargetColorId("target-2"));
  });

  it("defaults icons from target kind", () => {
    expect(defaultComputeTargetIconId("managed_cloud")).toBe("cloud");
    expect(defaultComputeTargetIconId("ssh")).toBe("monitor");
  });

  it("normalizes persisted preferences", () => {
    expect(normalizeComputeTargetAppearancePreference({
      targetId: " target-1 ",
      displayName: " Build host ",
      iconId: "bolt",
      colorId: "amber",
    })).toEqual({
      targetId: "target-1",
      displayName: "Build host",
      iconId: "bolt",
      colorId: "amber",
    });
  });

  it("falls back when persisted options are unknown", () => {
    expect(normalizeComputeTargetAppearancePreference({
      targetId: "target-1",
      iconId: "server-rack",
      colorId: "cyan",
    })).toEqual({
      targetId: "target-1",
      displayName: null,
      iconId: "monitor",
      colorId: "blue",
    });
  });

  it("resolves local display names without mutating the cloud target name", () => {
    const appearance = resolveComputeTargetAppearance({
      targetId: "target-1",
      displayName: "Cloud name",
      kind: "ssh",
      preference: {
        targetId: "target-1",
        displayName: "Local name",
        iconId: "terminal",
        colorId: "green",
      },
    });

    expect(appearance).toMatchObject({
      displayName: "Local name",
      iconId: "terminal",
      colorId: "green",
    });
  });
});
