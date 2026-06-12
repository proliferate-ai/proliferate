// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { createTranscriptState, type ThoughtItem, type ToolCallItem } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  thoughtItem,
  toolItem,
} from "@proliferate/product-domain/chats/transcript/transcript-presentation-test-fixtures";
import { ProposedPlanToolCallIdsProvider } from "./ProposedPlanToolCallIdsContext";
import { TranscriptItemBlock } from "./TranscriptItemBlock";

vi.mock("@/hooks/cowork/workflows/use-open-cowork-coding-session", () => ({
  useOpenCoworkCodingSession: () => vi.fn(),
}));

vi.mock("@/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
});

describe("TranscriptItemBlock", () => {
  it("suppresses Claude plan fallback rendering when the source item id matches", () => {
    const transcript = createTranscriptState("session-1");
    const fallback = claudeExitPlanFallback();
    transcript.itemsById = { fallback };

    const { container } = render(
      <ProposedPlanToolCallIdsProvider value={new Set(["fallback"])}>
        <TranscriptItemBlock
          item={fallback}
          transcript={transcript}
          workspaceId={null}
          onOpenArtifact={() => {}}
        />
      </ProposedPlanToolCallIdsProvider>,
    );

    expect(container.textContent).not.toContain("Fallback plan body");
  });

  it("renders Claude plan fallback content when no proposed plan source matches", () => {
    const transcript = createTranscriptState("session-1");
    const fallback = claudeExitPlanFallback();
    transcript.itemsById = { fallback };

    const { container } = render(
      <ProposedPlanToolCallIdsProvider value={new Set()}>
        <TranscriptItemBlock
          item={fallback}
          transcript={transcript}
          workspaceId={null}
          onOpenArtifact={() => {}}
        />
      </ProposedPlanToolCallIdsProvider>,
    );

    expect(container.textContent).toContain("Fallback plan body");
  });

  it("renders tool calls in an activity block without external vertical padding", () => {
    const transcript = createTranscriptState("session-1");
    const item = genericToolCall();
    transcript.itemsById = { [item.itemId]: item };

    const { container } = render(
      <ProposedPlanToolCallIdsProvider value={new Set()}>
        <TranscriptItemBlock
          item={item}
          transcript={transcript}
          workspaceId={null}
          onOpenArtifact={() => {}}
        />
      </ProposedPlanToolCallIdsProvider>,
    );

    expect(container.innerHTML).toContain("data-transcript-activity-block");
    expect(container.innerHTML).toContain("data-transcript-activity-shell");
    expect(activityBlockClassName(container)).toBe("");
    expect(container.textContent).toContain("Tool call");
  });

  it("renders thinking blocks in an activity block without external vertical padding", () => {
    const transcript = createTranscriptState("session-1");
    const item = genericThought();
    transcript.itemsById = { [item.itemId]: item };

    const { container } = render(
      <ProposedPlanToolCallIdsProvider value={new Set()}>
        <TranscriptItemBlock
          item={item}
          transcript={transcript}
          workspaceId={null}
          onOpenArtifact={() => {}}
        />
      </ProposedPlanToolCallIdsProvider>,
    );

    expect(container.innerHTML).toContain("data-transcript-activity-block");
    expect(container.innerHTML).toContain("data-transcript-activity-shell");
    expect(activityBlockClassName(container)).toBe("");
    expect(container.textContent).toContain("Thinking");
  });
});

function activityBlockClassName(container: HTMLElement): string {
  const block = container.querySelector("[data-transcript-activity-block]");
  expect(block).toBeTruthy();
  return block?.getAttribute("class") ?? "";
}

function claudeExitPlanFallback(): ToolCallItem {
  return {
    ...toolItem("fallback", "turn-1", 1, "mode_switch"),
    sourceAgentKind: "claude",
    nativeToolName: "ExitPlanMode",
    toolCallId: null,
    contentParts: [{ type: "tool_result_text", text: "Fallback plan body" }],
  };
}

function genericToolCall(): ToolCallItem {
  return {
    ...toolItem("tool-1", "turn-1", 1, "other"),
    title: "Tool call",
    nativeToolName: "TodoWrite",
  };
}

function genericThought(): ThoughtItem {
  return {
    ...thoughtItem("thought-1", "turn-1", 1, false),
    text: "Inspecting the transcript stack.",
  };
}
