import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import { toolCallItem } from "#product/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";

function fileReadItem(index: number): ToolCallItem {
  const basename = `TranscriptSurface${index + 1}.tsx`;
  const workspacePath = `apps/packages/product-client/src/components/workspace/chat/${basename}`;
  return toolCallItem({
    itemId: `tool-ledger-read-${index}`,
    toolCallId: `tool-ledger-read-${index}`,
    title: `Read ${basename}`,
    nativeToolName: "Read",
    toolKind: "read",
    semanticKind: "file_read",
    contentParts: [{
      type: "file_read",
      path: `/Users/pablo/proliferate/${workspacePath}`,
      workspacePath,
      basename,
      scope: "range",
      startLine: 1,
      endLine: 80,
      preview: "export function TranscriptSurface() { return null; }",
    }],
  });
}

export const PLAYGROUND_ACTIVITY_LEDGER_READ_ITEMS = Array.from(
  { length: 14 },
  (_, index) => fileReadItem(index),
);

export const PLAYGROUND_ACTIVITY_LEDGER_EDIT_ITEMS: ToolCallItem[] = [
  fileReadItem(20),
  toolCallItem({
    itemId: "tool-ledger-edit",
    toolCallId: "tool-ledger-edit",
    title: "Edit CollapsedActions.tsx",
    nativeToolName: "Edit",
    toolKind: "edit",
    semanticKind: "file_change",
    contentParts: [{
      type: "file_change",
      operation: "edit",
      path: "/Users/pablo/proliferate/apps/packages/product-client/src/components/workspace/chat/tool-calls/CollapsedActions.tsx",
      workspacePath: "apps/packages/product-client/src/components/workspace/chat/tool-calls/CollapsedActions.tsx",
      basename: "CollapsedActions.tsx",
      additions: 12,
      deletions: 4,
      patch: "@@ -1,2 +1,2 @@\n-old ledger\n+polished ledger",
    }],
  }),
];

export const PLAYGROUND_ACTIVITY_LEDGER_TRANSCRIPT: TranscriptState = {
  sessionMeta: {
    sessionId: "playground-activity-ledger",
    title: "Activity ledger playground",
    updatedAt: "2026-07-18T12:00:03Z",
    nativeSessionId: null,
    sourceAgentKind: "codex",
  },
  turnOrder: [],
  turnsById: {},
  itemsById: Object.fromEntries(
    [...PLAYGROUND_ACTIVITY_LEDGER_READ_ITEMS, ...PLAYGROUND_ACTIVITY_LEDGER_EDIT_ITEMS]
      .map((item) => [item.itemId, item]),
  ),
  openAssistantItemId: null,
  openThoughtItemId: null,
  pendingInteractions: [],
  availableCommands: [],
  liveConfig: null,
  currentModeId: null,
  usageState: null,
  unknownEvents: [],
  isStreaming: false,
  lastSeq: 20,
  pendingPrompts: [],
  linkCompletionsByCompletionId: {},
  latestLinkCompletionBySessionLinkId: {},
};
