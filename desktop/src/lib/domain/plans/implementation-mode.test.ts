import { describe, expect, it } from "vitest";
import type { NormalizedSessionControl } from "@anyharness/sdk";
import { resolvePlanImplementationModeSwitch } from "./implementation-mode";

describe("resolvePlanImplementationModeSwitch", () => {
  it("switches collaboration plan mode to default before implementation", () => {
    expect(resolvePlanImplementationModeSwitch({
      collaborationMode: control({
        rawConfigId: "collaboration_mode",
        currentValue: "plan",
        values: ["default", "plan"],
      }),
      mode: control({
        rawConfigId: "mode",
        currentValue: "read-only",
        values: ["read-only", "auto"],
      }),
    })).toEqual({
      rawConfigId: "collaboration_mode",
      value: "default",
    });
  });

  it("does not change read-only permission mode", () => {
    expect(resolvePlanImplementationModeSwitch({
      mode: control({
        rawConfigId: "mode",
        currentValue: "read-only",
        values: ["read-only", "auto"],
      }),
    })).toBeNull();
  });

  it("falls back to mode when the agent uses mode=plan", () => {
    expect(resolvePlanImplementationModeSwitch({
      mode: control({
        rawConfigId: "mode",
        currentValue: "plan",
        values: ["default", "plan"],
      }),
    })).toEqual({
      rawConfigId: "mode",
      value: "default",
    });
  });
});

function control(input: {
  rawConfigId: string;
  currentValue: string;
  values: string[];
}): NormalizedSessionControl {
  return {
    key: input.rawConfigId,
    rawConfigId: input.rawConfigId,
    label: input.rawConfigId,
    currentValue: input.currentValue,
    settable: true,
    values: input.values.map((value) => ({
      value,
      label: value,
      description: null,
    })),
  };
}
