// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { createTranscriptState, type ThoughtItem, type ToolCallItem } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  thoughtItem,
  toolItem,
  userItem,
} from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";
import { ProposedPlanToolCallIdsProvider } from "#product/components/workspace/chat/transcript/ProposedPlanToolCallIdsContext";
import { TranscriptItemBlock } from "#product/components/workspace/chat/transcript/TranscriptItemBlock";

vi.mock("#product/hooks/cowork/workflows/use-open-cowork-coding-session", () => ({
  useOpenCoworkCodingSession: () => vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
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

  it("renders known mode tools as a phase divider with the mode transition", () => {
    const transcript = createTranscriptState("session-1");
    const item: ToolCallItem = {
      ...toolItem("mode-1", "turn-1", 1, "mode_switch"),
      nativeToolName: "switch_mode",
      rawInput: { from_mode: "plan", mode: "default" },
    };
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

    expect(container.querySelector("[data-mode-transition-divider]")).toBeTruthy();
    expect(container.textContent).toContain("Plan mode → Default");
    expect(container.textContent).not.toContain("Mode change");
  });

  it("renders loosely mode-tagged tools as a normal tool row, not a divider", () => {
    const transcript = createTranscriptState("session-1");
    const item: ToolCallItem = {
      ...toolItem("mode-2", "turn-1", 1, "mode_switch"),
      title: "update_model_mode",
      nativeToolName: "update_model_mode",
    };
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

    expect(container.querySelector("[data-mode-transition-divider]")).toBeNull();
    expect(container.textContent).toContain("update_model_mode");
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
    // Completed reasoning is labeled "Thought" so the animated status owns
    // the live word "Thinking".
    expect(container.textContent).toContain("Thought");
  });

  it("renders a session-scoped agent wake pointer as a wake receipt, not prompt text", () => {
    const transcript = createTranscriptState("session-1");
    const item = {
      ...userItem("agent-wake", "turn-1", 1),
      text: "Hidden pointer body naming the target session",
      promptProvenance: {
        type: "agentWake" as const,
        targetSessionId: "target-1",
        label: "billing-webhooks",
      },
    };
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

    // The receipt shows the shared delegated-agent identity (a generated name
    // keyed on the target session), and never an outcome: a session-scoped
    // pointer carries no completion row to read one from.
    expect(container.textContent).toContain("finished");
    expect(container.textContent).not.toContain("a turn");
    expect(container.textContent).not.toContain("Hidden pointer body");
    expect(container.querySelector("[title]")?.getAttribute("title"))
      .toContain("billing-webhooks");
  });

  it("renders an inbound agent message as chip + verb, never as a user bubble", () => {
    const transcript = createTranscriptState("session-1");
    const item = agentMessageItem({ sessionLinkId: null });
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

    // ADR §4: "Message content never gets its own UI." The row is a chip and a
    // verb; the literal body only exists in the hover card's title.
    expect(container.querySelector("[data-agent-inbound-message]")).toBeTruthy();
    expect(container.querySelector("[data-chat-user-message]")).toBeNull();
    expect(container.textContent).not.toContain("The retry ceiling was the culprit");
    expect(container.textContent).toContain("messaged");
  });

  it("never calls a peer's message a parent's: no link, no parent claim", () => {
    const transcript = createTranscriptState("session-1");
    const item = agentMessageItem({ sessionLinkId: null });
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

    expect(container.innerHTML).not.toContain("Sent by parent");
    expect(
      container.querySelector("[data-agent-inbound-message]")
        ?.getAttribute("data-agent-inbound-origin"),
    ).toBe("peer");
  });

  it("says parent only when a delegation link says so", () => {
    const transcript = createTranscriptState("session-1");
    const item = agentMessageItem({ sessionLinkId: "link-1" });
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

    expect(container.querySelector("[data-chat-user-message]")).toBeNull();
    expect(
      container.querySelector("[data-agent-inbound-message]")
        ?.getAttribute("data-agent-inbound-origin"),
    ).toBe("parent");
  });
});

function agentMessageItem({ sessionLinkId }: { sessionLinkId: string | null }) {
  return {
    ...userItem("agent-message", "turn-1", 1),
    text: "The retry ceiling was the culprit — pushed the fix.",
    promptProvenance: {
      type: "agentSession" as const,
      sourceSessionId: "peer-1",
      sessionLinkId,
      label: "dispatch-peer",
    },
  };
}

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
