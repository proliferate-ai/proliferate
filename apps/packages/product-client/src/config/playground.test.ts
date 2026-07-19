import { describe, expect, it } from "vitest";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnyHarnessRuntime } from "@anyharness/sdk-react";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-fixtures";
import { ChatComposerDock } from "#product/components/workspace/chat/input/ChatComposerDock";
import { SCENARIOS, type ScenarioKey } from "#product/config/playground";
import { renderDelegationSlot } from "#product/components/playground/delegation/PlaygroundComposerDelegation";
import { renderActiveSlot } from "#product/components/playground/composer-slots/PlaygroundActiveSlotFixtures";
import { renderAttachedSlot } from "#product/components/playground/composer-slots/PlaygroundAttachedSlotFixtures";
import { renderOutboundSlot } from "#product/components/playground/composer-slots/PlaygroundOutboundSlotFixtures";
import { PlaygroundLoadingStates } from "#product/components/playground/loading/PlaygroundLoadingStates";
import { renderComposerSurfaceForScenario } from "#product/components/playground/PlaygroundComposerSurfaces";
import { PLAYGROUND_SLASH_COMMANDS } from "#product/lib/domain/chat/__fixtures__/playground/composer-surface-fixtures";
import {
  PLAYGROUND_SUBAGENT_STRIP_ROWS,
} from "#product/lib/domain/chat/__fixtures__/playground/delegation-fixtures";

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
  "tool-activity-ledger",
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
  "subagents-queued-wake",
  "subagents-queued-wake-with-approval",
];

// The composer surface renders ComposerModelSelectorControl, which calls
// useNavigate(), useProductHost(), and react-query hooks; static-render it
// inside the same provider stack the app mounts so those hooks have context.
function renderComposerSurfaceMarkup(scenario: ScenarioKey): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // ProductHostProvider and AnyHarnessRuntime declare `children` as a required
  // prop, so createElement needs it inside the props object to typecheck.
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ProductHostProvider, {
        host: makeTestProductHost(),
        children: createElement(AnyHarnessRuntime, {
          runtimeUrl: null,
          children: createElement(
            MemoryRouter,
            null,
            renderComposerSurfaceForScenario(scenario) as ReactElement,
          ),
        }),
      }),
    ),
  );
}

function visibleText(html: string): string {
  let out = "";
  let inTag = false;
  for (const ch of html) {
    if (ch === "<") inTag = true;
    else if (ch === ">") inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
}

describe("playground scenarios", () => {
  it("includes user-input card scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(USER_INPUT_SCENARIOS));
  });

  it("includes compact tool-call scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(TOOL_CALL_SCENARIOS));
  });

  it("includes a loading-states scenario with auth, thinking, and skeleton fixtures", () => {
    expect(Object.keys(SCENARIOS)).toContain("loading-states");

    const html = renderToStaticMarkup(createElement(PlaygroundLoadingStates));
    expect(html).toContain("Checking your session");
    expect(html).toContain("Thinking");
    expect(html).toContain("Thinking timing lab");
    expect(html).toContain("Sweep duration");
    expect(html).toContain(
      "--thinking-text-duration: 2400ms; --thinking-text-easing: linear;",
    );
    expect(html).toContain("Restoring session");
    expect(html).not.toContain("data-jank-canary=\"braille\"");
  });

  it("includes Codex-style diff scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(DIFF_PLAYGROUND_SCENARIOS));
  });

  it("includes delegated agents composer and wake scenarios for visual iteration", () => {
    expect(Object.keys(SCENARIOS)).toEqual(expect.arrayContaining(SUBAGENT_PLAYGROUND_SCENARIOS));
    expect(PLAYGROUND_SUBAGENT_STRIP_ROWS.length).toBeGreaterThan(6);
    expect(isValidElement(renderDelegationSlot("subagents-composer-few"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-composer-many"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-queued-wake"))).toBe(true);
    expect(isValidElement(renderDelegationSlot("subagents-queued-wake-with-approval"))).toBe(true);
    expect(isValidElement(renderOutboundSlot("subagents-queued-wake"))).toBe(true);
    expect(isValidElement(renderOutboundSlot("subagents-queued-wake-with-approval"))).toBe(true);
    expect(isValidElement(renderActiveSlot("subagents-queued-wake-with-approval"))).toBe(true);

    const subagentComposerHtml = renderToStaticMarkup(renderDelegationSlot("subagents-composer-many"));
    expect(subagentComposerHtml).not.toContain("color-mix");
    expect(subagentComposerHtml).not.toContain("style=");
    expect(subagentComposerHtml).not.toMatch(/Codex|Claude|Grok|gpt-|sonnet|opus|model/i);
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

  it("keeps queued rows compact and exposes steer, reorder, and edit actions", () => {
    const plainHtml = renderToStaticMarkup(renderOutboundSlot("pending-prompts-multi"));
    expect(plainHtml).toContain("line-clamp-2");
    expect(plainHtml).toContain("min-w-0");
    expect(plainHtml).toContain("whitespace-pre-wrap");
    // Head-of-queue entry is dispatching: it shows the shared "Thinking" shimmer
    // state hint and drops the edit affordance while in flight.
    expect(plainHtml).toContain("Thinking");
    expect(plainHtml.match(/aria-label="Edit queued message"/g)).toHaveLength(2);
    expect(plainHtml.match(/aria-label="Send next — interrupts the current turn"/g))
      .toHaveLength(2);
    expect(plainHtml.match(/aria-label="Reorder queued message"/g)).toHaveLength(2);

    const editingHtml = renderToStaticMarkup(renderOutboundSlot("pending-prompts-editing"));
    expect(editingHtml).toContain("Editing…");
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

  it("includes slash command scenarios with grouped and empty states", () => {
    expect(Object.keys(SCENARIOS)).toContain("slash-command-search");
    expect(Object.keys(SCENARIOS)).toContain("slash-command-empty");
    expect(PLAYGROUND_SLASH_COMMANDS.some((command) => command.group === "MCP")).toBe(true);

    const groupedHtml = renderComposerSurfaceMarkup("slash-command-search");
    // The tray renders the leading slash in its own styled span, so assert the
    // user-visible text rather than raw markup bytes. Character-wise scan (not
    // a sanitizer): drop everything between tag delimiters.
    const groupedText = visibleText(groupedHtml);
    expect(groupedText).toContain("/compact");
    expect(groupedText).toContain("MCP");

    const emptyHtml = renderComposerSurfaceMarkup("slash-command-empty");
    expect(emptyHtml).toContain("No matching slash commands.");
  });

  it("renders a long composer input scenario through the shared editor surface", () => {
    expect(Object.keys(SCENARIOS)).toContain("composer-long-input");
    const html = renderComposerSurfaceMarkup("composer-long-input");
    expect(html).toContain("data-chat-composer-editor");
    expect(html).toContain("data-telemetry-mask");
  });

  it("includes an attachment preview scenario for composer, transcript, and viewer iteration", () => {
    expect(Object.keys(SCENARIOS)).toContain("attachment-previews");
    expect(isValidElement(renderComposerSurfaceForScenario("attachment-previews"))).toBe(true);
  });
});
