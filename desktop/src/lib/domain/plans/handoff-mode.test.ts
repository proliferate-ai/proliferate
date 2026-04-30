import { describe, expect, it } from "vitest";
import type { NormalizedSessionControl } from "@anyharness/sdk";
import {
  listPlanHandoffModeOptions,
  resolvePlanHandoffModeId,
  resolvePlanHandoffModeIdFromOptions,
  resolvePlanHandoffPrePromptConfigChanges,
} from "./handoff-mode";

describe("plan handoff mode helpers", () => {
  it("returns the vetted handoff defaults for supported agent families", () => {
    expect(resolvePlanHandoffModeId("claude")).toBe("bypassPermissions");
    expect(resolvePlanHandoffModeId("codex")).toBe("full-access");
    expect(resolvePlanHandoffModeId("gemini")).toBe("yolo");
  });

  it("falls back to the first non-plan mode when the static default is unavailable", () => {
    expect(resolvePlanHandoffModeIdFromOptions("missing", [
      { value: "default" },
      { value: "auto" },
    ])).toBe("default");
  });

  it("excludes plan mode from selectable options", () => {
    expect(listPlanHandoffModeOptions("claude").map((option) => option.value)).toEqual([
      "default",
      "acceptEdits",
      "dontAsk",
      "bypassPermissions",
    ]);
    expect(listPlanHandoffModeOptions("gemini").map((option) => option.value)).toEqual([
      "default",
      "autoEdit",
      "yolo",
    ]);
  });

  it("returns undefined when no configured handoff mode exists", () => {
    expect(resolvePlanHandoffModeId("")).toBeUndefined();
    expect(resolvePlanHandoffModeId(null)).toBeUndefined();
    expect(resolvePlanHandoffModeId(undefined)).toBeUndefined();
  });

  it("resolves Codex collaboration mode back to default before prompting", () => {
    expect(resolvePlanHandoffPrePromptConfigChanges(control({
      currentValue: "plan",
      values: ["default", "plan"],
    }))).toEqual([{
      rawConfigId: "collaboration_mode",
      value: "default",
    }]);
  });

  it("does not add pre-prompt config changes when the session is already outside plan mode", () => {
    expect(resolvePlanHandoffPrePromptConfigChanges(control({
      currentValue: "default",
      values: ["default", "plan"],
    }))).toEqual([]);
    expect(resolvePlanHandoffPrePromptConfigChanges(null)).toEqual([]);
  });
});

function control(input: {
  currentValue: string;
  values: string[];
  settable?: boolean;
}): NormalizedSessionControl {
  return {
    key: "collaboration_mode",
    rawConfigId: "collaboration_mode",
    label: "Collaboration mode",
    currentValue: input.currentValue,
    settable: input.settable ?? true,
    values: input.values.map((value) => ({
      value,
      label: value,
      description: null,
    })),
  };
}
