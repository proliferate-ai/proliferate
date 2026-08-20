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

const messageListPropsSpy = vi.fn();

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
const renderTranscriptLinkMock = vi.fn(() => null);
const renderTranscriptInlineCodeMock = vi.fn(() => null);
vi.mock("#product/components/workspace/chat/transcript/transcript-markdown", () => ({
  renderTranscriptLink: (...args: unknown[]) => renderTranscriptLinkMock(...args),
  renderTranscriptInlineCode: (...args: unknown[]) => renderTranscriptInlineCodeMock(...args),
}));
// Mirrors AgentsPaneDetail.test.tsx's convention: MessageList's own row
// rendering is its own test's responsibility. Here we assert on the
// `transcript` prop it receives, which is where BackgroundSubagentView's
// translation wiring actually lives.
vi.mock("#product/components/workspace/chat/transcript/MessageList", () => ({
  MessageList: (props: { transcript: TranscriptState; sessionViewState: string; activeSessionId: string }) => {
    messageListPropsSpy(props);
    return (
      <div data-testid="message-list">
        {props.transcript.turnOrder.flatMap((turnId) =>
          (props.transcript.turnsById[turnId]?.itemOrder ?? []).map((itemId) => {
            const item = props.transcript.itemsById[itemId];
            const text = item && "text" in item ? item.text : null;
            return (
              <div key={itemId} data-testid="transcript-row" data-item-kind={item?.kind}>
                {text}
              </div>
            );
          }),
        )}
      </div>
    );
  },
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

/** A synthetic, fully fictional Claude-CLI session-log JSONL tail — one
 * user prompt and one assistant text reply — used to exercise the real
 * `claude-session-log` translator end to end. */
function syntheticClaudeSessionLogJsonl(): string {
  const userLine = {
    type: "user",
    uuid: "line-u1",
    parentUuid: null,
    isSidechain: false,
    timestamp: "2026-08-17T00:00:00.000Z",
    sessionId: "child-session-1",
    message: { role: "user", content: "Summarize the fixture directory." },
  };
  const assistantLine = {
    type: "assistant",
    uuid: "line-a1",
    parentUuid: "line-u1",
    isSidechain: false,
    timestamp: "2026-08-17T00:00:01.000Z",
    sessionId: "child-session-1",
    message: {
      role: "assistant",
      id: "msg-a1",
      model: "claude-test",
      content: [{ type: "text", text: "It holds three example fixtures." }],
      stop_reason: "end_turn",
    },
  };
  return `${JSON.stringify(userLine)}\n${JSON.stringify(assistantLine)}\n`;
}

afterEach(() => {
  feedStreamState = { content: "", connected: false, error: null };
  transcriptState = { transcript: null };
  sessionAgentKind = "claude";
  useFeedStreamMock.mockClear();
  messageListPropsSpy.mockClear();
  renderTranscriptLinkMock.mockClear();
  renderTranscriptInlineCodeMock.mockClear();
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

  it("wires only the link transcript renderer into the initial-prompt body (user-authored)", () => {
    const transcript = createTranscriptState("session-1");
    const item = launchToolCallItem({
      rawInput: {
        run_in_background: true,
        prompt: "See [config](/repo/config.json) and `src/index.ts`.",
      },
    });
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

    expect(renderTranscriptLinkMock).toHaveBeenCalled();
    // The prompt is user-authored: backticked text must stay inert, so the
    // inline-code renderer is never injected even though the content has one.
    expect(renderTranscriptInlineCodeMock).not.toHaveBeenCalled();
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

  describe("transcript-shaped rendering (rung R4b)", () => {
    it("claude: maps the tail_file JSONL into a TranscriptState and hands it to MessageList", () => {
      feedStreamState = { content: syntheticClaudeSessionLogJsonl(), connected: true, error: null };
      sessionAgentKind = "claude";

      render(
        <BackgroundSubagentView
          subagent={makeSubagent()}
          sessionId="session-1"
          workspaceId="workspace-1"
          onBack={() => {}}
        />,
      );

      expect(screen.getByTestId("message-list")).toBeTruthy();
      expect(screen.getByText("Summarize the fixture directory.")).toBeTruthy();
      expect(screen.getByText("It holds three example fixtures.")).toBeTruthy();
      expect(messageListPropsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sessionViewState: "idle", activeSessionId: "agent-1" }),
      );
      const passedTranscript = messageListPropsSpy.mock.calls[0]?.[0]?.transcript as TranscriptState;
      expect(passedTranscript.turnOrder.length).toBeGreaterThan(0);
    });

    it("codex: the identical JSONL text renders as raw tail, never through MessageList (negative control on the provider gate)", () => {
      feedStreamState = { content: syntheticClaudeSessionLogJsonl(), connected: true, error: null };
      sessionAgentKind = "codex";

      render(
        <BackgroundSubagentView
          subagent={makeSubagent()}
          sessionId="session-1"
          workspaceId="workspace-1"
          onBack={() => {}}
        />,
      );

      expect(screen.queryByTestId("message-list")).toBeNull();
      expect(messageListPropsSpy).not.toHaveBeenCalled();
      expect(screen.getByText(/Summarize the fixture directory\./)).toBeTruthy();
    });

    it("claude with a malformed feed degrades to the raw-tail view rather than an empty transcript (no crash)", () => {
      feedStreamState = { content: "not json at all, just a log line\n", connected: true, error: null };
      sessionAgentKind = "claude";

      render(
        <BackgroundSubagentView
          subagent={makeSubagent()}
          sessionId="session-1"
          workspaceId="workspace-1"
          onBack={() => {}}
        />,
      );

      expect(screen.queryByTestId("message-list")).toBeNull();
      expect(messageListPropsSpy).not.toHaveBeenCalled();
      expect(screen.getByText(/not json at all, just a log line/)).toBeTruthy();
    });

    it("claude with no feed content yet shows the connecting/raw-tail state, not an empty MessageList", () => {
      feedStreamState = { content: "", connected: false, error: null };
      sessionAgentKind = "claude";

      render(
        <BackgroundSubagentView
          subagent={makeSubagent()}
          sessionId="session-1"
          workspaceId="workspace-1"
          onBack={() => {}}
        />,
      );

      expect(screen.queryByTestId("message-list")).toBeNull();
      expect(screen.getByText("Connecting…")).toBeTruthy();
    });
  });
});
