import { describe, expect, it } from "vitest";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatComposerDock } from "@/components/workspace/chat/input/ChatComposerDock";
import { SCENARIOS, type ScenarioKey } from "./playground";
import {
  renderActiveSlot,
  renderAttachedSlot,
  renderComposerSurfaceForScenario,
  renderDelegationSlot,
  renderMobilityOverlayPreview,
  renderOutboundSlot,
} from "@/components/playground/PlaygroundComposer";
import {
  FILE_MENTION_SEARCH_RESULTS,
  PLAYGROUND_REVIEW_COMPOSER_STATES,
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
  "subagents-review-starting-plan",
  "subagents-review-starting-code",
  "subagents-reviewing-plan",
  "subagents-reviewing-code",
  "subagents-review-feedback-ready",
  "subagents-review-complete",
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

const REVIEW_TRANSCRIPT_SCENARIOS: ScenarioKey[] = [
  "review-feedback-message",
  "review-complete-message",
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
    expect(isValidElement(renderDelegationSlot("subagents-review-starting-plan"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-review-starting-code"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-reviewing-plan"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-reviewing-code"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-review-feedback-ready"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-review-complete"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-queued-wake"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-queued-wake-with-approval"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-coding-review-with-approval"))).toBe(true);
    expect(isValidElement(renderOutboundSlot("subagents-queued-wake"))).toBe(true);
    expect(isValidElement(renderOutboundSlot("subagents-queued-wake-with-approval"))).toBe(true);
    expect(isValidElement(renderActiveSlot("subagents-queued-wake-with-approval"))).toBe(true);
    expect(isValidElement(renderActiveSlot("subagents-coding-review-with-approval"))).toBe(true);

    const subagentComposerHtml = renderToStaticMarkup(renderDelegationSlot("subagents-composer-many"));
    expect(subagentComposerHtml).not.toContain("color-mix");
    expect(subagentComposerHtml).not.toContain("style=");
    expect(subagentComposerHtml).not.toMatch(/Codex|Claude|Gemini|gpt-|sonnet|opus|model/i);

    const reviewStartingHtml = renderToStaticMarkup(renderDelegationSlot("subagents-review-starting-plan"));
    expect(reviewStartingHtml).toContain("3 agents reviewing plan");
    expect(reviewStartingHtml).toContain("Plan review · round 1/2");

    const reviewReadyHtml = renderToStaticMarkup(renderDelegationSlot("subagents-review-feedback-ready"));
    expect(reviewReadyHtml).toContain("3 agents critiqued plan");
    expect(reviewReadyHtml).toContain("Feedback ready · 3/3");
    expect(reviewReadyHtml).not.toMatch(/Codex|Claude|Gemini|gpt-|sonnet|opus|model/i);

    for (const state of Object.values(PLAYGROUND_REVIEW_COMPOSER_STATES)) {
      for (const row of state.rows) {
        expect("agentKind" in row).toBe(false);
        expect(row.detail ?? "").not.toMatch(/Codex|Claude|Gemini|gpt-|sonnet|opus|model/i);
      }
    }
  });

  it("renders cloud composer attached-slot scenarios", () => {
    for (const scenario of CLOUD_COMPOSER_SCENARIOS) {
      expect(isValidElement(renderAttachedSlot(scenario))).toBe(true);
    }
  });

  it("renders queued prompt scenarios through the outbound slot", () => {
    for (const scenario of QUEUE_COMPOSER_SCENARIOS) {
      expect(isValidElement(renderOutboundSlot(scenario))).toBe(true);
    }
    expect(renderActiveSlot("pending-prompts-single")).toBeNull();
    expect(isValidElement(renderActiveSlot("pending-prompts-with-approval"))).toBe(true);
  });

  it("renders subagent wake prompts as plain queued text", () => {
    const html = renderToStaticMarkup(renderOutboundSlot("subagents-queued-wake"));
    expect(html).toContain("runtime-server-sdk-survey finished");
    expect(html).not.toContain("Turn Completed");
    expect(html).not.toContain("Child session:");
    expect(html).toContain('aria-label="Delete queued message"');
    expect(html).not.toContain('aria-label="Edit queued message"');
  });

  it("renders review feedback prompts as single-line queue rows", () => {
    const readyHtml = renderToStaticMarkup(renderOutboundSlot("pending-review-feedback-ready"));
    expect(readyHtml).toContain("Review feedback ready");
    expect(readyHtml).toContain("truncate");
    expect(readyHtml).toContain("min-w-0");
    expect(readyHtml).toContain('aria-label="Delete queued message"');
    expect(readyHtml).not.toContain('aria-label="Edit queued message"');
    expect(readyHtml).not.toContain("Hidden critique body");
    expect(readyHtml).not.toContain("Loading reviewer results");
    expect(readyHtml).not.toContain("Open Reviewer critique");
    expect(readyHtml).not.toContain("whitespace-pre-wrap");

    const completeHtml = renderToStaticMarkup(renderOutboundSlot("pending-review-complete"));
    expect(completeHtml).toContain("Review complete");
    expect(completeHtml).not.toContain("Final hidden reviewer note");
  });

  it("includes collapsed review feedback transcript message scenarios", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(REVIEW_TRANSCRIPT_SCENARIOS));
  });

  it("keeps queued rows single-line and hides edit on the active edit row", () => {
    const plainHtml = renderToStaticMarkup(renderOutboundSlot("pending-prompts-multi"));
    expect(plainHtml).toContain("truncate");
    expect(plainHtml).toContain("min-w-0");
    expect(plainHtml).not.toContain("whitespace-pre-wrap");

    const editingHtml = renderToStaticMarkup(renderOutboundSlot("pending-prompts-editing"));
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
          outboundSlot: renderOutboundSlot("pending-prompts-with-approval"),
          activeSlot: renderActiveSlot("pending-prompts-with-approval"),
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
          outboundSlot: createElement("div", { "data-slot": "outbound" }),
          activeSlot: createElement("div", { "data-slot": "active" }),
          attachedSlot: createElement("div", { "data-slot": "attached" }),
          children: createElement("div", { "data-slot": "composer" }),
        },
      ),
    );
    const order = ["outbound", "active", "attached", "composer"]
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

  it("keeps in-flight mobility in the footer and renders recovery as an overlay", () => {
    expect(Object.keys(SCENARIOS)).toContain("mobility-cloud-active");
    expect(renderMobilityOverlayPreview("mobility-in-flight")).toBeNull();
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
