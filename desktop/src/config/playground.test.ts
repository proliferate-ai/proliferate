import { describe, expect, it } from "vitest";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatComposerDock } from "@/components/workspace/chat/input/ChatComposerDock";
import { SCENARIOS, type ScenarioKey } from "./playground";
import {
  renderContextSlot,
  renderComposerSurfaceForScenario,
  renderDelegationSlot,
  renderInteractionSlot,
  renderMobilityOverlayPreview,
  renderQueueSlot,
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

const DIFF_PLAYGROUND_SCENARIOS: ScenarioKey[] = [
  "end-turn-multi-file-diff",
  "git-diff-panel",
];

const SUBAGENT_PLAYGROUND_SCENARIOS: ScenarioKey[] = [
  "subagents-composer-few",
  "subagents-composer-many",
  "subagents-queued-wake",
  "subagents-queued-wake-with-approval",
  "subagents-coding-review-with-approval",
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

const QUEUE_COMPOSER_SCENARIOS: ScenarioKey[] = [
  "pending-prompts-single",
  "pending-prompts-multi",
  "pending-prompts-editing",
  "pending-prompts-with-approval",
  "pending-review-feedback-ready",
  "pending-review-complete",
  "subagents-queued-wake",
  "subagents-queued-wake-with-approval",
];

describe("playground scenarios", () => {
  it("includes user-input card scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(USER_INPUT_SCENARIOS));
  });

  it("includes compact tool-call scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(TOOL_CALL_SCENARIOS));
  });

  it("includes Codex-style diff scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(DIFF_PLAYGROUND_SCENARIOS));
  });

  it("includes subagent composer and wake scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(SUBAGENT_PLAYGROUND_SCENARIOS));
    expect(PLAYGROUND_SUBAGENT_STRIP_ROWS.length).toBeGreaterThan(6);
    expect(isValidElement(renderDelegationSlot("subagents-composer-few"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-composer-many"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-queued-wake"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-queued-wake-with-approval"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-coding-review-with-approval"))).toBe(true);
    expect(isValidElement(renderQueueSlot("subagents-queued-wake"))).toBe(true);
    expect(isValidElement(renderQueueSlot("subagents-queued-wake-with-approval"))).toBe(true);
    expect(isValidElement(renderInteractionSlot("subagents-queued-wake-with-approval"))).toBe(true);
    expect(isValidElement(renderInteractionSlot("subagents-coding-review-with-approval"))).toBe(true);

    const subagentComposerHtml = renderToStaticMarkup(renderDelegationSlot("subagents-composer-many"));
    expect(subagentComposerHtml).not.toContain("color-mix");
    expect(subagentComposerHtml).not.toContain("style=");
  });

  it("renders cloud composer context-slot scenarios", () => {
    for (const scenario of CLOUD_COMPOSER_SCENARIOS) {
      expect(isValidElement(renderContextSlot(scenario))).toBe(true);
    }
  });

  it("renders queued prompt scenarios through the queue slot", () => {
    for (const scenario of QUEUE_COMPOSER_SCENARIOS) {
      expect(isValidElement(renderQueueSlot(scenario))).toBe(true);
    }
    expect(renderInteractionSlot("pending-prompts-single")).toBeNull();
    expect(isValidElement(renderInteractionSlot("pending-prompts-with-approval"))).toBe(true);
  });

  it("renders subagent wake prompts as plain queued text", () => {
    const html = renderToStaticMarkup(renderQueueSlot("subagents-queued-wake"));
    expect(html).toContain("runtime-server-sdk-survey finished");
    expect(html).not.toContain("Turn Completed");
    expect(html).not.toContain("Child session:");
    expect(html).toContain('aria-label="Delete queued message"');
    expect(html).not.toContain('aria-label="Edit queued message"');
  });

  it("renders review feedback prompts as single-line queue rows", () => {
    const readyHtml = renderToStaticMarkup(renderQueueSlot("pending-review-feedback-ready"));
    expect(readyHtml).toContain("Review feedback ready");
    expect(readyHtml).toContain("truncate");
    expect(readyHtml).toContain("min-w-0");
    expect(readyHtml).toContain('aria-label="Delete queued message"');
    expect(readyHtml).not.toContain('aria-label="Edit queued message"');
    expect(readyHtml).not.toContain("Hidden critique body");
    expect(readyHtml).not.toContain("Loading reviewer results");
    expect(readyHtml).not.toContain("Open Reviewer critique");
    expect(readyHtml).not.toContain("whitespace-pre-wrap");

    const completeHtml = renderToStaticMarkup(renderQueueSlot("pending-review-complete"));
    expect(completeHtml).toContain("Review complete");
    expect(completeHtml).not.toContain("Final hidden reviewer note");
  });

  it("keeps queued rows single-line and hides edit on the active edit row", () => {
    const plainHtml = renderToStaticMarkup(renderQueueSlot("pending-prompts-multi"));
    expect(plainHtml).toContain("truncate");
    expect(plainHtml).toContain("min-w-0");
    expect(plainHtml).not.toContain("whitespace-pre-wrap");

    const editingHtml = renderToStaticMarkup(renderQueueSlot("pending-prompts-editing"));
    expect(editingHtml).toContain("editing in composer");
    expect(editingHtml.match(/aria-label="Edit queued message"/g)).toHaveLength(1);
    expect(editingHtml.match(/aria-label="Delete queued message"/g)).toHaveLength(2);
  });

  it("keeps queued prompts before active questions and permission approvals", () => {
    const html = renderToStaticMarkup(
      createElement(
        ChatComposerDock,
        {
          backdrop: false,
          queueSlot: renderQueueSlot("pending-prompts-with-approval"),
          interactionSlot: renderInteractionSlot("pending-prompts-with-approval"),
          children: createElement("div", { "data-slot": "composer" }),
        },
      ),
    );
    const queueIndex = html.indexOf("Queued messages");
    const approvalIndex = html.indexOf("wc -l /Users/pablo/proliferate/server/proliferate/**/*.py | tail -1");
    expect(queueIndex).toBeGreaterThanOrEqual(0);
    expect(approvalIndex).toBeGreaterThanOrEqual(0);
    expect(queueIndex).toBeLessThan(approvalIndex);
  });

  it("keeps delegated-work controls attached to the composer", () => {
    const html = renderToStaticMarkup(
      createElement(
        ChatComposerDock,
        {
          backdrop: false,
          contextSlot: createElement("div", { "data-slot": "context" }),
          queueSlot: createElement("div", { "data-slot": "queue" }),
          interactionSlot: createElement("div", { "data-slot": "interaction" }),
          delegationSlot: createElement("div", { "data-slot": "delegation" }),
          children: createElement("div", { "data-slot": "composer" }),
        },
      ),
    );
    const order = ["context", "queue", "interaction", "delegation", "composer"]
      .map((slot) => html.indexOf(`data-slot="${slot}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it("keeps subagents closest to the composer inside the delegation stack", () => {
    const html = renderToStaticMarkup(renderDelegationSlot("subagents-coding-review-with-approval"));
    const order = ["Review agents", "Cowork coding workspaces", "Subagents"]
      .map((label) => html.indexOf(`aria-label="${label}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(html.match(/aria-label="Delegated work"/g)).toHaveLength(1);
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

  it("renders a long composer input scenario through the shared editor surface", () => {
    expect(Object.keys(SCENARIOS)).toContain("composer-long-input");
    const html = renderToStaticMarkup(renderComposerSurfaceForScenario("composer-long-input"));
    expect(html).toContain("data-chat-composer-editor");
    expect(html).toContain("data-telemetry-mask");
  });
});
