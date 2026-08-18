// @vitest-environment jsdom

import { useLayoutEffect, type ReactNode } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { TranscriptState } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "#product/components/workspace/chat/transcript/MessageList";

const mocks = vi.hoisted(() => ({
  indexHook: vi.fn(),
  chatView: vi.fn(),
  scrollToRowKey: vi.fn(),
  parseMatchId: vi.fn(() => ({ rowUnitId: "turn:turn-1:block:content" })),
  jumpToMatch: vi.fn(() => true),
  searchState: {
    open: true,
    surface: "chat",
    query: "needle",
    activeMatchId: "chatrow:turn:turn-1:block:content:0",
  },
}));

vi.mock("#product/hooks/chat/lifecycle/use-chat-transcript-content-search", () => ({
  useChatTranscriptContentSearch: (input: unknown) => mocks.indexHook(input),
}));

vi.mock("#product/stores/search/content-search-store", () => ({
  useContentSearchStore: (selector: (state: typeof mocks.searchState) => unknown) =>
    selector(mocks.searchState),
}));

vi.mock("#product/lib/domain/content-search/chat-row-match-jump", () => ({
  chatRowKeyFromUnitId: () => "row:turn-1",
  parseChatRowMatchId: mocks.parseMatchId,
  scrollActiveChatRowMatchIntoView: mocks.jumpToMatch,
}));

vi.mock("#product/components/workspace/chat/transcript/ChatTranscriptView", () => ({
  ChatTranscriptView: (props: {
    contentSearch: { query: string } | null;
    scrollHandleRef: { current: { scrollToRowKey: (key: string) => void } | null };
  }) => {
    mocks.chatView(props);
    useLayoutEffect(() => {
      props.scrollHandleRef.current = { scrollToRowKey: mocks.scrollToRowKey };
      return () => {
        props.scrollHandleRef.current = null;
      };
    }, [props.scrollHandleRef]);
    return <div data-testid="chat-transcript-view" />;
  },
}));

vi.mock("#product/components/diagnostics/DebugProfiler", () => ({
  DebugProfiler: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("#product/components/workspace/chat/transcript/TranscriptContexts", () => ({
  TranscriptContextProviders: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("#product/components/workspace/chat/transcript/ProposedPlanToolCallIdsContext", () => ({
  ProposedPlanToolCallIdsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("#product/components/workspace/chat/transcript/TranscriptEntryMotionContext", () => ({
  TranscriptEntryMotionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("#product/components/workspace/chat/transcript/TranscriptScrollPriorityContext", () => ({
  TranscriptScrollPriorityProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("#product/hooks/chat/ui/use-transcript-scroll-priority", () => ({
  useTranscriptScrollPriority: ({ latestValue }: { latestValue: unknown }) => ({
    effectiveValue: latestValue,
    isUserScrolling: false,
    prioritizeScrollSample: vi.fn(),
    registerSynchronousPause: vi.fn(),
  }),
}));

vi.mock("#product/hooks/chat/ui/use-transcript-scroll-sample", () => ({
  useTranscriptScrollSample: () => vi.fn(),
}));

vi.mock("#product/hooks/chat/workflows/use-prompt-outbox-actions", () => ({
  usePromptOutboxActions: () => ({ retryPrompt: vi.fn(), dismissPrompt: vi.fn() }),
}));

vi.mock("#product/hooks/workspaces/facade/files/use-workspace-file-actions", () => ({
  useWorkspaceFileActions: () => ({ openFile: vi.fn(), openGitReviewPane: vi.fn() }),
}));

vi.mock("#product/hooks/cowork/workflows/use-open-cowork-artifact", () => ({
  useOpenCoworkArtifact: () => ({ openArtifact: vi.fn() }),
}));

vi.mock("#product/hooks/activity/workflows/use-open-background-work-pane", () => ({
  useOpenBackgroundWorkPane: () => vi.fn(),
}));

vi.mock("#product/hooks/ui/debug/use-debug-render-count", () => ({
  useDebugRenderCount: () => {},
}));

vi.mock("#product/lib/infra/interaction/typing-activity-store", () => ({
  useTypingActivityStore: (selector: (state: { typingActive: boolean }) => unknown) =>
    selector({ typingActive: false }),
}));

vi.mock("#product/domain/chats/transcript/transcript-rendering", () => ({
  collectToolCallIdsWithProposedPlan: () => new Set<string>(),
}));

vi.mock("#product/components/workspace/chat/transcript/GoalTranscriptEventRow", () => ({
  GoalTranscriptEventRow: () => null,
}));
vi.mock("#product/components/workspace/chat/transcript/WorkspaceCreationReceipt", () => ({
  WorkspaceCreationReceipt: () => null,
}));
vi.mock("#product/components/workspace/chat/transcript/TranscriptPendingPromptRow", () => ({
  TranscriptPendingPromptRow: () => null,
}));
vi.mock("#product/components/workspace/chat/transcript/TranscriptTurnRow", () => ({
  TranscriptTurnRow: () => null,
}));

const transcript = {
  turnOrder: [],
  turnsById: {},
  itemsById: {},
} as unknown as TranscriptState;

function renderMessageList(contentSearchEnabled?: boolean) {
  const props = {
    activeSessionId: "session-child",
    selectedWorkspaceId: "workspace-1",
    optimisticPrompt: null,
    transcript,
    sessionViewState: "idle" as const,
  };
  return contentSearchEnabled === undefined
    ? render(<MessageList {...props} />)
    : render(<MessageList {...props} contentSearchEnabled={contentSearchEnabled} />);
}

describe("MessageList embedded content search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchState.open = true;
    mocks.searchState.surface = "chat";
    mocks.searchState.query = "needle";
    mocks.searchState.activeMatchId = "chatrow:turn:turn-1:block:content:0";
  });

  afterEach(() => {
    cleanup();
  });

  it("registers, paints, and jumps nothing when content search is disabled", () => {
    renderMessageList(false);

    expect(mocks.indexHook).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(mocks.chatView).toHaveBeenLastCalledWith(expect.objectContaining({
      contentSearch: null,
    }));
    expect(mocks.parseMatchId).not.toHaveBeenCalled();
    expect(mocks.scrollToRowKey).not.toHaveBeenCalled();
    expect(mocks.jumpToMatch).not.toHaveBeenCalled();
  });

  it("keeps default-on main-transcript registration, paint, and jump behavior", async () => {
    renderMessageList();

    expect(mocks.indexHook).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    expect(mocks.chatView).toHaveBeenLastCalledWith(expect.objectContaining({
      contentSearch: { query: "needle" },
    }));
    await waitFor(() => expect(mocks.scrollToRowKey).toHaveBeenCalledWith("row:turn-1"));
    expect(mocks.jumpToMatch).toHaveBeenCalledWith({
      rowUnitId: "turn:turn-1:block:content",
    });
  });
});
