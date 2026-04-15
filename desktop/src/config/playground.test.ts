import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { SCENARIOS, type ScenarioKey } from "./playground";
import {
  renderMobilityOverlayPreview,
  renderTopSlot,
} from "@/components/playground/PlaygroundComposer";

const USER_INPUT_SCENARIOS: ScenarioKey[] = [
  "user-input-single-option",
  "user-input-single-freeform",
  "user-input-option-plus-other",
  "user-input-secret",
  "user-input-multi-question",
];

const TOOL_CALL_SCENARIOS: ScenarioKey[] = [
  "tool-bash-running",
  "tool-bash-completed",
  "tool-bash-failed",
  "tool-read-preview",
  "tool-file-change-running",
  "tool-file-change-failed",
  "tool-file-change-diff",
  "tool-reasoning",
  "tool-cowork-artifact",
  "tool-generic-result",
  "tool-subagent-task",
];

const CLOUD_COMPOSER_SCENARIOS: ScenarioKey[] = [
  "cloud-provisioning",
  "cloud-applying-files",
  "cloud-blocked",
  "cloud-error",
  "cloud-reconnecting",
  "cloud-reconnect-error",
];

describe("playground scenarios", () => {
  it("includes user-input card scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(USER_INPUT_SCENARIOS));
  });

  it("includes compact tool-call scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(TOOL_CALL_SCENARIOS));
  });

  it("renders cloud composer top-slot scenarios", () => {
    for (const scenario of CLOUD_COMPOSER_SCENARIOS) {
      expect(isValidElement(renderTopSlot(scenario))).toBe(true);
    }
  });

  it("renders mobility overlay playground scenarios through the production view", () => {
    expect(isValidElement(renderMobilityOverlayPreview("mobility-in-flight"))).toBe(true);
    expect(isValidElement(renderMobilityOverlayPreview("mobility-failed"))).toBe(true);
  });
});
