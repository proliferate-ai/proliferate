import type { ReactNode } from "react";
import { AssistantMessage, ChatTranscriptView, ThinkingText } from "@proliferate/ui";

const noop = () => {};

const baseItem = (overrides: Record<string, unknown>) => ({
  itemId: "item-1",
  turnId: "turn-1",
  status: "completed",
  sourceAgentKind: "claude",
  messageId: null,
  title: null,
  nativeToolName: null,
  parentToolCallId: null,
  contentParts: [],
  timestamp: "2026-07-02T10:10:00.000Z",
  startedSeq: 1,
  lastUpdatedSeq: 1,
  completedSeq: 1,
  completedAt: "2026-07-02T10:10:02.000Z",
  isStreaming: false,
  ...overrides,
});

const TURN_1_PROMPT = "Why does the composer control row need its own frame component?";
const TURN_1_REPLY = `Because both composer surfaces have to agree on one grid.

- \`ChatComposerControlRowFrame\` owns the \`auto / minmax(0,1fr) / auto\` grid
- the 8px cluster gap is declared once, not per consumer
- the cloud strip re-uses it instead of re-deriving the spacing`;

const TURN_2_PROMPT = "And the surface itself?";
const TURN_2_REPLY = `\`ChatComposerSurface\` owns the composer radius role
(\`--radius-composer\`, 20px) plus the translucent fill and 0.5px stroke, so a
consumer can retune just the composer without moving every \`rounded-xl\`
surface in the app.`;

const ITEMS = {
  "item-1": baseItem({
    itemId: "item-1",
    turnId: "turn-1",
    kind: "user_message",
    text: TURN_1_PROMPT,
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
  }),
  "item-2": baseItem({
    itemId: "item-2",
    turnId: "turn-1",
    kind: "assistant_prose",
    text: TURN_1_REPLY,
    startedSeq: 2,
    lastUpdatedSeq: 2,
    completedSeq: 2,
  }),
  "item-3": baseItem({
    itemId: "item-3",
    turnId: "turn-2",
    kind: "user_message",
    text: TURN_2_PROMPT,
    startedSeq: 3,
    lastUpdatedSeq: 3,
    completedSeq: 3,
  }),
  "item-4": baseItem({
    itemId: "item-4",
    turnId: "turn-2",
    kind: "assistant_prose",
    text: TURN_2_REPLY,
    startedSeq: 4,
    lastUpdatedSeq: 4,
    completedSeq: 4,
  }),
};

const transcript = (overrides: Record<string, unknown> = {}) => ({
  sessionMeta: {
    sessionId: "sess-4f21",
    title: "Composer frame extraction",
    updatedAt: "2026-07-02T10:12:00.000Z",
    nativeSessionId: "claude-9a2c",
    sourceAgentKind: "claude",
  },
  turnOrder: ["turn-1", "turn-2"],
  turnsById: {
    "turn-1": {
      turnId: "turn-1",
      itemOrder: ["item-1", "item-2"],
      startedAt: "2026-07-02T10:10:00.000Z",
      completedAt: "2026-07-02T10:10:12.000Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
    "turn-2": {
      turnId: "turn-2",
      itemOrder: ["item-3", "item-4"],
      startedAt: "2026-07-02T10:11:00.000Z",
      completedAt: "2026-07-02T10:11:09.000Z",
      stopReason: "end_turn",
      fileBadges: [
        { path: "apps/packages/product-ui/src/chat/composer/ChatComposerSurface.tsx", additions: 12, deletions: 3 },
      ],
    },
  },
  itemsById: ITEMS,
  openAssistantItemId: null,
  openThoughtItemId: null,
  pendingInteractions: [],
  availableCommands: [],
  liveConfig: null,
  currentModeId: null,
  usageState: null,
  unknownEvents: [],
  isStreaming: false,
  lastSeq: 4,
  pendingPrompts: [],
  linkCompletionsByCompletionId: {},
  latestLinkCompletionBySessionLinkId: {},
  ...overrides,
});

/** The host's own turn row: a user prompt bubble above its assistant reply. */
const TurnRow = ({ turn, transcriptState }: { turn: any; transcriptState: any }) => {
  const items = turn.itemOrder
    .map((itemId: string) => transcriptState.itemsById[itemId])
    .filter(Boolean);
  return (
    <div className="flex flex-col gap-4 py-5">
      {items.map((item: any) =>
        item.kind === "user_message" ? (
          <div key={item.itemId} className="flex justify-end">
            <div className="max-w-lg rounded-2xl bg-surface-elevated-secondary px-4 py-2 text-message text-foreground">
              {item.text}
            </div>
          </div>
        ) : (
          <AssistantMessage key={item.itemId} content={item.text} />
        ),
      )}
    </div>
  );
};

/** The transcript is `flex-1 min-h-0` — it needs a bounded, clipped host. */
const ChatSurface = ({ children }: { children: ReactNode }) => (
  <div
    className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background"
    style={{ height: 560 }}
  >
    {children}
  </div>
);

const RENDERERS = {
  renderTurnRow: ({ turn, transcript: transcriptState }: any) => (
    <TurnRow turn={turn} transcriptState={transcriptState} />
  ),
  renderPendingPromptRow: ({ prompt, optimisticTrailingStatus }: any) => (
    <div className="flex flex-col items-end gap-2 py-5">
      <div className="max-w-lg rounded-2xl bg-surface-elevated-secondary px-4 py-2 text-message text-foreground">
        {prompt.text}
      </div>
      {optimisticTrailingStatus}
    </div>
  ),
  renderPendingPromptTrailingStatus: () => <ThinkingText text="Queued" />,
};

export const Conversation = () => (
  <ChatSurface>
    <ChatTranscriptView
      {...RENDERERS}
      state={{
        activeSessionId: "sess-4f21",
        selectedWorkspaceId: "ws-proliferate",
        transcript: transcript(),
        sessionViewState: "idle",
      }}
    />
  </ChatSurface>
);

export const WithPendingPrompt = () => (
  <ChatSurface>
    <ChatTranscriptView
      {...RENDERERS}
      state={{
        activeSessionId: "sess-4f21",
        selectedWorkspaceId: "ws-proliferate",
        transcript: transcript(),
        sessionViewState: "working",
        optimisticPrompt: {
          seq: 5,
          promptId: "prompt-9c11",
          text: "Now do the same for the cloud composer strip.",
          contentParts: [],
          queuedAt: "2026-07-02T10:12:00.000Z",
        },
      }}
    />
  </ChatSurface>
);

export const WithOlderHistory = () => (
  <ChatSurface>
    <ChatTranscriptView
      {...RENDERERS}
      state={{
        activeSessionId: "sess-4f21",
        selectedWorkspaceId: "ws-proliferate",
        transcript: transcript(),
        sessionViewState: "idle",
        history: {
          hasOlderHistory: true,
          isLoadingOlderHistory: true,
          olderHistoryCursor: 42,
          onLoadOlderHistory: noop,
        },
      }}
    />
  </ChatSurface>
);

/** Search open on the chat surface: the transcript paints prose matches. */
export const ContentSearchActive = () => (
  <ChatSurface>
    <ChatTranscriptView
      {...RENDERERS}
      state={{
        activeSessionId: "sess-4f21",
        selectedWorkspaceId: "ws-proliferate",
        transcript: transcript(),
        sessionViewState: "idle",
      }}
      contentSearch={{ query: "composer" }}
    />
  </ChatSurface>
);
