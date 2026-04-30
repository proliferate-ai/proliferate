import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { SCENARIOS, type ScenarioKey } from "./playground";
import {
  renderMobilityOverlayPreview,
  renderQueueSlot,
  renderSubagentSlot,
  renderTopSlot,
} from "@/components/playground/PlaygroundComposer";
import {
  FILE_MENTION_SEARCH_RESULTS,
  PLAYGROUND_SUBAGENT_STRIP_ROWS,
} from "@/lib/domain/chat/__fixtures__/playground";
import { isValidWorkspaceRelativePath } from "@/lib/domain/chat/file-mention-links";

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

const SUBAGENT_PLAYGROUND_SCENARIOS: ScenarioKey[] = [
  "subagents-composer-few",
  "subagents-composer-many",
  "subagents-queued-wake",
  "subagent-wake-card",
];

const CLOUD_COMPOSER_SCENARIOS: ScenarioKey[] = [
  "cloud-first-runtime",
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

  it("includes subagent composer and wake scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(SUBAGENT_PLAYGROUND_SCENARIOS));
    expect(PLAYGROUND_SUBAGENT_STRIP_ROWS.length).toBeGreaterThan(6);
    expect(isValidElement(renderSubagentSlot("subagents-composer-few"))).toBe(true);
    expect(isValidElement(renderSubagentSlot("subagents-composer-many"))).toBe(true);
    expect(isValidElement(renderSubagentSlot("subagents-queued-wake"))).toBe(true);
    expect(isValidElement(renderQueueSlot("subagents-queued-wake"))).toBe(true);
  });

  it("renders cloud composer top-slot scenarios", () => {
    for (const scenario of CLOUD_COMPOSER_SCENARIOS) {
      expect(isValidElement(renderTopSlot(scenario))).toBe(true);
    }
  });

  it("renders mobility overlay playground scenarios through the production view", () => {
    expect(Object.keys(SCENARIOS)).toContain("mobility-cloud-active");
    expect(isValidElement(renderMobilityOverlayPreview("mobility-in-flight"))).toBe(true);
    expect(isValidElement(renderMobilityOverlayPreview("mobility-failed"))).toBe(true);
  });

  it("includes a file mention search scenario with workspace-relative fixture paths", () => {
    expect(Object.keys(SCENARIOS)).toContain("file-mention-search");
    expect(FILE_MENTION_SEARCH_RESULTS.length).toBeGreaterThan(0);
    expect(FILE_MENTION_SEARCH_RESULTS.every((result) =>
      isValidWorkspaceRelativePath(result.path)
    )).toBe(true);
  });
});
