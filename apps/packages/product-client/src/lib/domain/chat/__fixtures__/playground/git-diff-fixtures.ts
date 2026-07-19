import type { TranscriptState } from "@anyharness/sdk";
import { toolCallItem } from "#product/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";

export const PLAYGROUND_PATCH_README = [
  "@@ -1,4 +1,5 @@",
  " Proliferate",
  "-Old transcript rows",
  "+Codex-style transcript rows",
  "+Shared diff cards",
  " Runtime orchestration",
].join("\n");

export const PLAYGROUND_PATCH_GIT_PANEL = [
  "@@ -24,7 +24,8 @@ export function GitPanel() {",
  "   const isBranchMode = changesFilter === \"branch\";",
  "-  const defaultOpen = true;",
  "+  const defaultOpen = false;",
  "+  const surface = \"sidebar\";",
  "   return <Panel />;",
].join("\n");

export const PLAYGROUND_PATCH_MESSAGE_LIST = [
  "@@ -1040,7 +1040,7 @@ function TranscriptItemBlock() {",
  "   return (",
  "-    <div className=\"max-w-xl lg:max-w-3xl\">",
  "+    <div className=\"max-w-full\">",
  "       <ToolCallItemBlock />",
  "     </div>",
].join("\n");

export interface PlaygroundSidebarGitDiffFile {
  key: string;
  section: "Unstaged" | "Staged" | "Branch" | "Binary" | "Truncated" | "Empty";
  displayPath: string;
  additions: number;
  deletions: number;
  patch: string | null;
  binary?: boolean;
  truncated?: boolean;
}

export const PLAYGROUND_SIDEBAR_GIT_DIFF_SECTIONS: PlaygroundSidebarGitDiffFile["section"][] = [
  "Unstaged",
  "Staged",
  "Branch",
  "Binary",
  "Truncated",
  "Empty",
];

export const PLAYGROUND_SIDEBAR_GIT_DIFF_FILES: PlaygroundSidebarGitDiffFile[] = [
  {
    key: "unstaged-readme",
    section: "Unstaged",
    displayPath: "README.md",
    additions: 2,
    deletions: 1,
    patch: PLAYGROUND_PATCH_README,
  },
  {
    key: "staged-git-panel",
    section: "Staged",
    displayPath: "apps/desktop/src/components/workspace/git/GitPanel.tsx",
    additions: 2,
    deletions: 1,
    patch: PLAYGROUND_PATCH_GIT_PANEL,
  },
  {
    key: "branch-message-list",
    section: "Branch",
    displayPath: "apps/desktop/src/components/workspace/chat/transcript/MessageList.tsx",
    additions: 1,
    deletions: 1,
    patch: PLAYGROUND_PATCH_MESSAGE_LIST,
  },
  {
    key: "binary-image",
    section: "Binary",
    displayPath: "apps/desktop/src/assets/onboarding-preview.png",
    additions: 0,
    deletions: 0,
    patch: null,
    binary: true,
  },
  {
    key: "truncated-large",
    section: "Truncated",
    displayPath: "apps/desktop/src/index.css",
    additions: 24,
    deletions: 12,
    patch: PLAYGROUND_PATCH_README,
    truncated: true,
  },
];

const PLAYGROUND_END_TURN_FILE_CHANGES = [
  {
    itemId: "tool-end-diff-readme",
    path: "apps/packages/product-client/src/components/workspace/chat/transcript/TranscriptPatchTurnDiffPanel.tsx",
    additions: 3,
    deletions: 3,
    patch: PLAYGROUND_PATCH_README,
  },
  {
    itemId: "tool-end-diff-git",
    path: "apps/packages/product-client/src/components/workspace/chat/transcript/TurnDiffFileRow.tsx",
    additions: 1,
    deletions: 1,
    patch: PLAYGROUND_PATCH_GIT_PANEL,
  },
  {
    itemId: "tool-end-diff-transcript-row",
    path: "apps/packages/product-client/src/components/workspace/chat/transcript/TurnDiffPanel.test.tsx",
    additions: 5,
    deletions: 3,
    patch: PLAYGROUND_PATCH_MESSAGE_LIST,
  },
  {
    itemId: "tool-end-diff-collapsed-actions",
    path: "apps/packages/product-client/src/components/workspace/chat/transcript/TurnDiffPanel.tsx",
    additions: 4,
    deletions: 2,
    patch: PLAYGROUND_PATCH_MESSAGE_LIST,
  },
  {
    itemId: "tool-end-diff-dom-css",
    path: "apps/packages/product-client/src/components/workspace/chat/transcript/TurnDiffPanelHeader.tsx",
    additions: 2,
    deletions: 1,
    patch: PLAYGROUND_PATCH_MESSAGE_LIST,
  },
  {
    itemId: "tool-end-diff-transcript-spec",
    path: "apps/packages/product-client/src/components/workspace/chat/transcript/TurnDocumentReferenceCard.test.tsx",
    additions: 2,
    deletions: 1,
    patch: PLAYGROUND_PATCH_README,
  },
  {
    itemId: "tool-end-diff-document-resource",
    path: "specs/codebase/systems/product/chat/transcript.md",
    additions: 5,
    deletions: 2,
    patch: PLAYGROUND_PATCH_MESSAGE_LIST,
  },
  {
    itemId: "tool-end-diff-playground-config",
    path: "apps/packages/product-client/src/components/workspace/chat/transcript/TurnDocumentReferenceCard.tsx",
    additions: 3,
    deletions: 2,
    patch: PLAYGROUND_PATCH_MESSAGE_LIST,
  },
] as const;

export const PLAYGROUND_END_TURN_DIFF_TRANSCRIPT: TranscriptState = {
  sessionMeta: {
    sessionId: "playground-end-turn-diff",
    title: "End-turn diff playground",
    updatedAt: "2026-04-29T12:00:03Z",
    nativeSessionId: null,
    sourceAgentKind: "codex",
  },
  turnOrder: ["turn-end-diff"],
  turnsById: {
    "turn-end-diff": {
      turnId: "turn-end-diff",
      itemOrder: [
        "assistant-end-diff",
        ...PLAYGROUND_END_TURN_FILE_CHANGES.map((file) => file.itemId),
      ],
      startedAt: "2026-04-29T12:00:00Z",
      completedAt: "2026-04-29T12:00:03Z",
      stopReason: "end_turn",
      fileBadges: PLAYGROUND_END_TURN_FILE_CHANGES.map((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
      })),
    },
  },
  itemsById: {
    "assistant-end-diff": {
      kind: "assistant_prose",
      itemId: "assistant-end-diff",
      turnId: "turn-end-diff",
      status: "completed",
      sourceAgentKind: "codex",
      messageId: null,
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      timestamp: "2026-04-29T12:00:00Z",
      startedSeq: 1,
      lastUpdatedSeq: 1,
      completedSeq: 1,
      completedAt: "2026-04-29T12:00:00Z",
      text: "I updated the chat and git diff surfaces to share the Codex-style contract. The implementation notes are in [tool-call-blocks.md](docs/tool-call-blocks.md).",
      isStreaming: false,
    },
    ...Object.fromEntries(PLAYGROUND_END_TURN_FILE_CHANGES.map((file) => [
      file.itemId,
      toolCallItem({
        itemId: file.itemId,
        toolCallId: file.itemId,
        turnId: "turn-end-diff",
        title: `Edit ${extractFixtureBasename(file.path)}`,
        nativeToolName: "Edit",
        toolKind: "edit",
        semanticKind: "file_change",
        contentParts: [{
          type: "file_change",
          operation: "edit",
          path: `/Users/pablo/proliferate/${file.path}`,
          workspacePath: file.path,
          basename: extractFixtureBasename(file.path),
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
        }],
      }),
    ])),
  },
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
};

function extractFixtureBasename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}
