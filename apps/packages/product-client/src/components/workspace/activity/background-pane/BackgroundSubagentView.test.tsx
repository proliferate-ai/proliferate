/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranscriptState } from "@anyharness/sdk";
import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import { BackgroundSubagentView } from "./BackgroundSubagentView";

let feedStreamState: { content: string; connected: boolean; error: string | null } = {
  content: "",
  connected: false,
  error: null,
};
const useFeedStreamMock = vi.fn(() => feedStreamState);

let transcriptState: { transcript: TranscriptState | null } = { transcript: null };
let sessionAgentKind: string | null = "claude";

vi.mock("#product/stores/sessions/session-directory-store", () => ({
  useSessionDirectoryStore: (selector: (state: {
    entriesById: Record<string, { agentKind: string } | undefined>;
  }) => unknown) =>
    selector({
      entriesById: sessionAgentKind
        ? { "session-1": { agentKind: sessionAgentKind } }
        : {},
    }),
}));
vi.mock("#product/hooks/chat/derived/use-active-session-transcript-state", () => ({
  useTranscriptPaneStateForSession: () => transcriptState,
}));
vi.mock("#product/hooks/activity/derived/use-feed-stream", () => ({
  useFeedStream: (...args: unknown[]) => useFeedStreamMock(...args),
}));

function makeSubagent(overrides: Partial<ActivitySubagentWire> = {}): ActivitySubagentWire {
  return {
    id: "agent-1",
    agentType: "general-purpose",
    description: "Inspect the transcript pipeline",
    model: "claude-sonnet",
    background: true,
    status: { status: "running" },
    usage: null,
    feed: { feedId: "feed-1", kind: "transcript" },
    ...overrides,
  };
}

function launchToolCallItem(overrides: Partial<ToolCallItem> = {}): ToolCallItem {
  return {
    kind: "tool_call",
    itemId: "tool-launch",
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: "Agent",
    parentToolCallId: null,
    rawInput: { run_in_background: true, prompt: "Inspect the transcript pipeline." },
    rawOutput: {
      isAsync: true,
      agentId: "agent-1",
      outputFile: "/tmp/task.output",
      _anyharness: { backgroundWork: { trackerKind: "claude_async_agent", state: "pending" } },
    },
    contentParts: [],
    timestamp: "2026-08-16T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: "2026-08-16T00:00:00Z",
    toolCallId: "toolu_1",
    toolKind: "think",
    semanticKind: "subagent",
    approvalState: "none",
    ...overrides,
  } as ToolCallItem;
}

afterEach(() => {
  feedStreamState = { content: "", connected: false, error: null };
  transcriptState = { transcript: null };
  sessionAgentKind = "claude";
  useFeedStreamMock.mockClear();
  cleanup();
});

describe("BackgroundSubagentView", () => {
  it("renders the header identity, status, and provider", () => {
    render(
      <BackgroundSubagentView
        subagent={makeSubagent()}
        sessionId="session-1"
        workspaceId="workspace-1"
        onBack={() => {}}
      />,
    );
    expect(screen.getAllByText("Inspect the transcript pipeline").length).toBeGreaterThan(0);
    expect(screen.getByText(/Running/)).toBeTruthy();
    expect(screen.getByText(/Claude/)).toBeTruthy();
    expect(screen.getByText("read only")).toBeTruthy();
  });

  it("renders the correlated launch tool call's initial prompt", () => {
    const transcript = createTranscriptState("session-1");
    const item = launchToolCallItem();
    transcript.itemsById[item.itemId] = item;
    transcriptState = { transcript };

    render(
      <BackgroundSubagentView
        subagent={makeSubagent()}
        sessionId="session-1"
        workspaceId="workspace-1"
        onBack={() => {}}
      />,
    );

    expect(screen.getByText("Initial prompt")).toBeTruthy();
    expect(screen.getByText("Inspect the transcript pipeline.")).toBeTruthy();
  });

  it("omits the initial-prompt panel when no launch tool call correlates", () => {
    const transcript = createTranscriptState("session-1");
    transcriptState = { transcript };

    render(
      <BackgroundSubagentView
        subagent={makeSubagent()}
        sessionId="session-1"
        workspaceId="workspace-1"
        onBack={() => {}}
      />,
    );

    expect(screen.queryByText("Initial prompt")).toBeNull();
  });

  it("renders the feed's raw tail content (Codex-style fallback used for every harness)", () => {
    feedStreamState = { content: "Working on the task…\n", connected: true, error: null };
    render(
      <BackgroundSubagentView
        subagent={makeSubagent()}
        sessionId="session-1"
        workspaceId="workspace-1"
        onBack={() => {}}
      />,
    );
    expect(screen.getByText(/Working on the task…/)).toBeTruthy();
  });

  it("renders the exact read-only footer copy and no composer", () => {
    render(
      <BackgroundSubagentView
        subagent={makeSubagent()}
        sessionId="session-1"
        workspaceId="workspace-1"
        onBack={() => {}}
      />,
    );
    expect(
      screen.getByText("Read-only. Transcript mirrored from the agent; no composer."),
    ).toBeTruthy();
  });

  it("has no input/textarea/select write affordance anywhere in the view", () => {
    const { container } = render(
      <BackgroundSubagentView
        subagent={makeSubagent()}
        sessionId="session-1"
        workspaceId="workspace-1"
        onBack={() => {}}
      />,
    );
    expect(container.querySelectorAll("input").length).toBe(0);
    expect(container.querySelectorAll("textarea").length).toBe(0);
    expect(container.querySelectorAll("select").length).toBe(0);
  });

  it("fires onBack when the back control is clicked", () => {
    const onBack = vi.fn();
    render(
      <BackgroundSubagentView
        subagent={makeSubagent()}
        sessionId="session-1"
        workspaceId="workspace-1"
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to background work" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("enables the feed stream only when a feed ref is present", () => {
    render(
      <BackgroundSubagentView
        subagent={makeSubagent()}
        sessionId="session-1"
        workspaceId="workspace-1"
        onBack={() => {}}
      />,
    );
    expect(useFeedStreamMock).toHaveBeenCalledWith(
      { feedId: "feed-1", kind: "transcript" },
      { workspaceId: "workspace-1", enabled: true },
    );
  });

  it("disables the feed stream when there is no feed ref", () => {
    render(
      <BackgroundSubagentView
        subagent={makeSubagent({ feed: null })}
        sessionId="session-1"
        workspaceId="workspace-1"
        onBack={() => {}}
      />,
    );
    expect(useFeedStreamMock).toHaveBeenCalledWith(
      null,
      { workspaceId: "workspace-1", enabled: false },
    );
  });
});
