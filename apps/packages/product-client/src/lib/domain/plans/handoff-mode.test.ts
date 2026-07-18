import { describe, expect, it } from "vitest";
import type { NormalizedSessionControl } from "@anyharness/sdk";
import {
  listPlanHandoffModeOptions,
  resolvePlanHandoffModeId,
  resolvePlanHandoffModeIdFromOptions,
  resolvePlanHandoffPrePromptConfigChanges,
} from "#product/lib/domain/plans/handoff-mode";

describe("plan handoff mode helpers", () => {
  it("returns the vetted handoff defaults for supported agent families", () => {
    expect(resolvePlanHandoffModeId("claude", "bypassPermissions"))
      .toBe("bypassPermissions");
    expect(resolvePlanHandoffModeId("codex", "full-access")).toBe("full-access");
  });

  it("omits the mode when catalog curation is absent or unsupported", () => {
    expect(resolvePlanHandoffModeIdFromOptions("missing", [
      { value: "default" },
      { value: "auto" },
    ])).toBeUndefined();
    expect(resolvePlanHandoffModeId("codex", null)).toBeUndefined();
  });

  it("keeps a target-owned mode selectable when static presentation is stale", () => {
    expect(listPlanHandoffModeOptions("codex", "target-unattended"))
      .toContainEqual(expect.objectContaining({ value: "target-unattended" }));
  });

  it("excludes plan mode from selectable options", () => {
    expect(listPlanHandoffModeOptions("claude").map((option) => option.value)).toEqual([
      "default",
      "acceptEdits",
      "auto",
      "dontAsk",
      "bypassPermissions",
    ]);
  });

  it("returns undefined when no configured handoff mode exists", () => {
    expect(resolvePlanHandoffModeId("", "full-access")).toBeUndefined();
    expect(resolvePlanHandoffModeId(null, "full-access")).toBeUndefined();
    expect(resolvePlanHandoffModeId(undefined, "full-access")).toBeUndefined();
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
