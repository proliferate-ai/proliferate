import type {
  CoworkArtifactSummary,
  McpElicitationInteractionPayload,
  PlanEntry,
  ReviewAssignmentDetail,
  SearchWorkspaceFilesResponse,
  ToolCallItem,
  TranscriptState,
  UserInputQuestion,
} from "@anyharness/sdk";
import type { PermissionOptionAction } from "@/lib/domain/chat/chat-input-helpers";
import type { PendingPromptQueueEntry } from "@/lib/domain/chat/pending-prompt-queue";
import type { WorkspaceArrivalViewModel } from "@/lib/domain/workspaces/arrival";
import {
  buildCloudWorkspaceStatusScreenModel,
  type CloudWorkspaceStatusScreenModel,
} from "@/lib/domain/workspaces/cloud-workspace-status";
import type { SelectedCloudRuntimeViewModel } from "@/lib/domain/workspaces/cloud-runtime-state";
import type { CloudWorkspaceStatus, CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";

export const TODOS_SHORT: PlanEntry[] = [
  { content: "Read authoritative repo docs and MCP spec material", status: "completed" },
  { content: "Inspect current code paths for MCP tool injection", status: "in_progress" },
  { content: "Synthesize gap analysis and outline implementation work", status: "pending" },
];

export const TODOS_MID: PlanEntry[] = [
  { content: "Read foundation files: query keys, billing, credentials", status: "completed" },
  { content: "Read repo and branch file: use-cloud-repo-branches.ts", status: "completed" },
  { content: "Read workspace action flows", status: "in_progress" },
  { content: "Read workspace connection hooks", status: "pending" },
  { content: "Surface findings in a summary writeup", status: "pending" },
];

export const TODOS_LONG: PlanEntry[] = [
  { content: "Audit the existing plan panel implementation for dead branches", status: "completed" },
  { content: "Read the Codex HTML reference for todo tracker + plan approval", status: "completed" },
  { content: "Confirm toolKind is preserved on pending approval interactions", status: "completed" },
  { content: "Delete PlanBlock, InlinePermissionPrompt embeddedInComposer, merge booleans", status: "completed" },
  { content: "Create TodoTrackerPanel with fade mask and line-through", status: "in_progress" },
  { content: "Create ApprovalCard covering execute, edit, switch_mode variants", status: "pending" },
  { content: "Move presented plan bodies into first-class ProposedPlanCard items", status: "pending" },
  { content: "Intercept Claude ExitPlanMode in MessageList dispatch", status: "pending" },
  { content: "Update ChatView single-slot precedence (approval > todos > workspace > cloud)", status: "pending" },
  { content: "Add fade-mask CSS utility to index.css", status: "pending" },
  { content: "Rebase onto main and verify typecheck + tests pass", status: "pending" },
  { content: "Write a playground page so UI iteration doesn't require an LLM", status: "pending" },
];

export const FILE_MENTION_SEARCH_RESULTS: SearchWorkspaceFilesResponse["results"] = [
  {
    name: "ChatInput.tsx",
    path: "desktop/src/components/workspace/chat/input/ChatInput.tsx",
  },
  {
    name: "file-mentions.ts",
    path: "desktop/src/lib/domain/chat/file-mentions.ts",
  },
  {
    name: "chat-composer.md",
    path: "docs/frontend/specs/chat-composer.md",
  },
];

export const PLAYGROUND_LONG_COMPOSER_DRAFT = [
  "Clean up the workspace chat composer expansion behavior.",
  "",
  "The first line should stay pinned to the same visual top inset while the composer grows upward.",
  "The surface should not become a nested scroll area.",
  "The editor frame should not scroll.",
  "The textarea should keep growing until the configured workspace cap.",
  "After sixteen rows, only the textarea should scroll internally.",
  "Model controls and send/cancel actions need to remain visible.",
  "Attachment preview rows should not add a second top gap above the editor.",
  "Plan reference rows should follow the same spacing rule as file attachments.",
  "Queued-prompt editing should use the same autosize workflow.",
  "The Home composer remains intentionally capped at eight rows.",
  "The file mention search tray still renders above the composer surface.",
  "Focus behavior still depends on data-chat-composer-editor.",
  "Telemetry masking stays on the editable text surface.",
  "This scenario exists to make long prompt regressions visible in the playground.",
  "It should be long enough to exceed the workspace cap.",
  "It should make internal scrolling observable.",
  "It should not require a live AnyHarness session.",
  "It should share the production frame and autosize hook.",
].join("\n");

export const WORKSPACE_ARRIVAL_CREATED: WorkspaceArrivalViewModel = {
  workspaceId: "workspace-arrival-created",
  source: "worktree-created",
  kind: "worktree",
  workspacePath: "/Users/pablo/.proliferate/worktrees/proliferate/prism",
  workspaceKind: "worktree",
  workspaceName: "Prism",
  repoName: "proliferate",
  badgeLabel: "New worktree",
  eyebrow: "Ready to open",
  title: "Prism",
  subtitle: "Created in proliferate from main",
  setupTitle: "Repository setup",
  setupSummary: "No setup script configured yet",
  setupCommand: null,
  setupActionLabel: "Add setup script",
  setupStatusLabel: "Optional",
  setupTone: "default",
  setupDetail: null,
  setupTerminalId: null,
  branchName: "prism",
  baseBranchName: "main",
};

function cloudWorkspaceFixture(
  overrides: Partial<CloudWorkspaceSummary> = {},
): CloudWorkspaceSummary {
  return {
    id: "cloud-playground",
    displayName: "Cloud playground",
    actionBlockKind: null,
    actionBlockReason: null,
    postReadyPhase: "idle",
    postReadyFilesApplied: 0,
    postReadyFilesTotal: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    status: "pending",
    workspaceStatus: "pending",
    runtime: {
      environmentId: null,
      status: "pending",
      generation: 1,
      actionBlockKind: null,
      actionBlockReason: null,
    },
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    createdAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-14T00:01:00Z",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      baseBranch: "main",
      branch: "feature/cloud-status",
    },
    ...overrides,
  };
}

function cloudStatusFixture(
  overrides: Partial<CloudWorkspaceSummary> & { status?: CloudWorkspaceStatus } = {},
): CloudWorkspaceStatusScreenModel {
  return buildCloudWorkspaceStatusScreenModel(cloudWorkspaceFixture(overrides));
}

export const CLOUD_STATUS_PROVISIONING = cloudStatusFixture({
  status: "materializing",
});

export const CLOUD_STATUS_FIRST_RUNTIME = cloudStatusFixture({
  status: "materializing",
  runtime: {
    environmentId: "runtime-playground",
    status: "provisioning",
    generation: 0,
    actionBlockKind: null,
    actionBlockReason: null,
  },
});

export const CLOUD_STATUS_APPLYING_FILES = cloudStatusFixture({
  postReadyFilesApplied: 7,
  postReadyFilesTotal: 18,
  postReadyPhase: "applying_files",
  status: "ready",
});

export const CLOUD_STATUS_BLOCKED = cloudStatusFixture({
  actionBlockKind: "billing_quota",
  actionBlockReason: "Cloud usage is paused for this account.",
});

export const CLOUD_STATUS_ERROR = cloudStatusFixture({
  lastError: "Cloud setup could not finish. Check repo access, then retry.",
  status: "error",
});

export const CLOUD_RUNTIME_RECONNECTING: SelectedCloudRuntimeViewModel = {
  phase: "resuming",
  variant: "warm",
  tone: "pending",
  title: "Reconnecting cloud workspace",
  subtitle: "Runtime-backed actions are paused while the workspace reconnects.",
  actionBlockReason: "Cloud workspace is reconnecting. Runtime-backed actions are paused until it comes back.",
  preserveVisibleContent: true,
  showRetry: false,
};

export const CLOUD_RUNTIME_RECONNECT_ERROR: SelectedCloudRuntimeViewModel = {
  phase: "failed",
  variant: "warm",
  tone: "error",
  title: "Couldn't reconnect cloud workspace",
  subtitle: "Retry to restore chat, files, and terminals.",
  actionBlockReason: "Cloud workspace couldn't reconnect. Retry to restore chat, files, and terminals.",
  preserveVisibleContent: true,
  showRetry: true,
};
export const CLAUDE_PLAN_SHORT = `# Tighten onboarding copy

## Context
The current onboarding reads as "install five CLIs to get started." New users bounce because each step looks like a potential failure point.

## Changes
1. Collapse the three CLI steps into a single "Install proliferate" step with a platform picker.
2. Replace the three-paragraph explainer on the welcome page with a one-liner plus a "Learn more" link.
3. Remove the warning banner about cloud billing — it's misleading for free users.

## Verification
- Run the onboarding walkthrough on a fresh profile and confirm it completes in under 90 seconds.
- Check that the warning banner no longer appears for accounts with no billing history.
`;

export const CLAUDE_PLAN_LONG = `# Desktop Shortcut Unification Rollout

## Summary
Implement a full shortcut-system rollout for the desktop app in one functional change set, not a staged coexistence migration. The new system will cover every current app-level and workspace-level shortcut plus a new \`CmdOrCtrl+,\` Settings shortcut, while keeping truly local keyboard behavior local.

This plan is based on the current code, not the prior writeup. Pre-change baseline checks are green: \`cd desktop && pnpm exec tsc --noEmit\` and \`cargo check --manifest-path src-tauri/Cargo.toml\`.

## Implementation Changes

### 1. Replace ad hoc shortcut registration
**Files:** \`desktop/src/hooks/shortcuts/use-global-shortcuts.ts\`, \`desktop/src/config/shortcuts.ts\`

Consolidate the three existing shortcut registration points into a single descriptor list in \`config/shortcuts.ts\`. Each descriptor carries:
- \`id\`: stable string key
- \`label\`: user-facing accelerator text (e.g. "⌘K", "Esc")
- \`description\`: tooltip copy
- \`scope\`: "global" | "workspace" | "composer"
- \`handler\`: dispatched through a central keyboard router

### 2. Route keyboard events through a single dispatcher
**File:** new \`desktop/src/lib/keyboard/dispatcher.ts\`

The dispatcher matches against the descriptor list, takes the \`scope\` of the currently-focused element into account, and fires the handler. This replaces the \`useKeyboardShortcut\` hook and the inline \`onKeyDown\` listeners scattered across the codebase.

### 3. Add the missing Settings shortcut
Wire \`CmdOrCtrl+,\` to navigate to \`/settings\`. The accelerator surface should show in the macOS menu as well — update \`desktop/src-tauri/src/menu.rs\` to register a Settings menu item with the same accelerator.

### 4. Remove the \`useState\` noise in \`components/header.tsx\`
With the single-list migration, the header no longer needs its own \`Sheet\`/\`SheetContent\`/\`SheetTrigger\` machinery. Replace with plain inline links.

## Verification
- \`pnpm tsc --noEmit\` passes
- \`cargo check --manifest-path src-tauri/Cargo.toml\` passes
- Manual: every existing shortcut still fires, the new Settings shortcut opens settings, and the menu shows the accelerator
- Manual: \`Esc\` in the composer still clears focus without triggering workspace-level shortcuts
`;

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
    displayPath: "desktop/src/components/workspace/git/GitPanel.tsx",
    additions: 2,
    deletions: 1,
    patch: PLAYGROUND_PATCH_GIT_PANEL,
  },
  {
    key: "branch-message-list",
    section: "Branch",
    displayPath: "desktop/src/components/workspace/chat/transcript/MessageList.tsx",
    additions: 1,
    deletions: 1,
    patch: PLAYGROUND_PATCH_MESSAGE_LIST,
  },
  {
    key: "binary-image",
    section: "Binary",
    displayPath: "desktop/src/assets/onboarding-preview.png",
    additions: 0,
    deletions: 0,
    patch: null,
    binary: true,
  },
  {
    key: "truncated-large",
    section: "Truncated",
    displayPath: "desktop/src/index.css",
    additions: 24,
    deletions: 12,
    patch: PLAYGROUND_PATCH_README,
    truncated: true,
  },
];

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
      itemOrder: ["assistant-end-diff", "tool-end-diff-readme", "tool-end-diff-git"],
      startedAt: "2026-04-29T12:00:00Z",
      completedAt: "2026-04-29T12:00:03Z",
      stopReason: "end_turn",
      fileBadges: [
        { path: "README.md", additions: 2, deletions: 1 },
        {
          path: "desktop/src/components/workspace/git/GitPanel.tsx",
          additions: 2,
          deletions: 1,
        },
      ],
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
      text: "I updated the chat and git diff surfaces to share the Codex-style contract.",
      isStreaming: false,
    },
    "tool-end-diff-readme": toolCallItem({
      itemId: "tool-end-diff-readme",
      toolCallId: "tool-end-diff-readme",
      turnId: "turn-end-diff",
      title: "Edit README.md",
      nativeToolName: "Edit",
      toolKind: "edit",
      semanticKind: "file_change",
      contentParts: [{
        type: "file_change",
        operation: "edit",
        path: "/Users/pablo/proliferate/README.md",
        workspacePath: "README.md",
        basename: "README.md",
        additions: 2,
        deletions: 1,
        patch: PLAYGROUND_PATCH_README,
      }],
    }),
    "tool-end-diff-git": toolCallItem({
      itemId: "tool-end-diff-git",
      toolCallId: "tool-end-diff-git",
      turnId: "turn-end-diff",
      title: "Edit GitPanel.tsx",
      nativeToolName: "Edit",
      toolKind: "edit",
      semanticKind: "file_change",
      contentParts: [{
        type: "file_change",
        operation: "edit",
        path: "/Users/pablo/proliferate/desktop/src/components/workspace/git/GitPanel.tsx",
        workspacePath: "desktop/src/components/workspace/git/GitPanel.tsx",
        basename: "GitPanel.tsx",
        additions: 2,
        deletions: 1,
        patch: PLAYGROUND_PATCH_GIT_PANEL,
      }],
    }),
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

const PLAYGROUND_ARTIFACT_SUMMARY: CoworkArtifactSummary = {
  id: "artifact-playground",
  path: "artifacts/status-board.tsx",
  type: "application/vnd.proliferate.react",
  title: "Status board",
  description: "Compact artifact row preview",
  createdAt: "2026-04-12T00:00:00Z",
  updatedAt: "2026-04-12T00:00:01Z",
  exists: true,
  sizeBytes: 2048,
  modifiedAt: "2026-04-12T00:00:01Z",
};

export const PLAYGROUND_COWORK_ARTIFACT_TOOL_CALL = toolCallItem({
  itemId: "tool-artifact",
  toolCallId: "tool-artifact",
  title: "Create artifact",
  nativeToolName: "mcp__cowork__create_artifact",
  semanticKind: "cowork_artifact_create",
  rawInput: {
    title: "Status board",
    path: "artifacts/status-board.tsx",
  },
  rawOutput: PLAYGROUND_ARTIFACT_SUMMARY,
});

const subagentItem = toolCallItem({
  itemId: "tool-agent",
  toolCallId: "tool-agent",
  title: "mcp__subagents__create_subagent",
  nativeToolName: "mcp__subagents__create_subagent",
  semanticKind: "subagent",
  rawInput: {
    agentKind: "codex",
    label: "repo-reviewer",
    modelId: "gpt-5.4",
    prompt: "Inspect the transcript rendering path and report whether nested tool calls use compact rows.",
  },
  rawOutput: {
    childSessionId: "child-repo-reviewer",
    sessionLinkId: "link-repo-reviewer",
    promptStatus: "running",
    wakeScheduleCreated: true,
    wakeScheduled: true,
  },
  contentParts: [
    {
      type: "tool_result_text",
      text: JSON.stringify({
        childSessionId: "child-repo-reviewer",
        sessionLinkId: "link-repo-reviewer",
        promptStatus: "running",
        wakeScheduleCreated: true,
        wakeScheduled: true,
      }),
    },
  ],
});

const subagentCommandItem = toolCallItem({
  itemId: "tool-agent-command",
  toolCallId: "tool-agent-command",
  parentToolCallId: "tool-agent",
  title: "npm test -- --runInBand",
  nativeToolName: "Bash",
  semanticKind: "terminal",
  rawInput: {
    command: "pnpm --dir desktop exec vitest run src/config/playground.test.ts",
  },
  contentParts: [
    {
      type: "terminal_output",
      terminalId: "terminal-playground",
      event: "output",
      data: "RUN  src/config/playground.test.ts\nPASS compact tool-call scenarios\n",
    },
  ],
});

const subagentReadItem = toolCallItem({
  itemId: "tool-agent-read",
  toolCallId: "tool-agent-read",
  parentToolCallId: "tool-agent",
  title: "Read ToolActionRow.tsx",
  nativeToolName: "Read",
  toolKind: "read",
  semanticKind: "file_read",
  contentParts: [
    {
      type: "file_read",
      path: "/Users/pablo/proliferate/desktop/src/components/workspace/chat/tool-calls/ToolActionRow.tsx",
      workspacePath: "desktop/src/components/workspace/chat/tool-calls/ToolActionRow.tsx",
      basename: "ToolActionRow.tsx",
      scope: "range",
      startLine: 1,
      endLine: 12,
      preview: "export function ToolActionRow() {\n  return null;\n}",
    },
  ],
});

export const PLAYGROUND_SUBAGENT_TRANSCRIPT: TranscriptState = {
  sessionMeta: {
    sessionId: "playground-subagent",
    title: "Tool row playground",
    updatedAt: "2026-04-12T00:00:02Z",
    nativeSessionId: null,
    sourceAgentKind: "codex",
  },
  turnOrder: ["turn-subagent"],
  turnsById: {
    "turn-subagent": {
      turnId: "turn-subagent",
      itemOrder: ["assistant-intro", "tool-agent"],
      startedAt: "2026-04-12T00:00:00Z",
      completedAt: "2026-04-12T00:00:03Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
  },
  itemsById: {
    "assistant-intro": {
      kind: "assistant_prose",
      itemId: "assistant-intro",
      turnId: "turn-subagent",
      status: "completed",
      sourceAgentKind: "codex",
      messageId: null,
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      timestamp: "2026-04-12T00:00:00Z",
      startedSeq: 1,
      lastUpdatedSeq: 1,
      completedSeq: 1,
      completedAt: "2026-04-12T00:00:00Z",
      text: "I will delegate the transcript check and inspect the nested activity.",
      isStreaming: false,
    },
    "tool-agent": subagentItem,
    "tool-agent-command": subagentCommandItem,
    "tool-agent-read": subagentReadItem,
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

type PlaygroundSubagentStripRow = {
  sessionLinkId: string;
  childSessionId: string;
  label: string;
  statusLabel: string;
  latestCompletionLabel: string | null;
  wakeScheduled: boolean;
};

export const PLAYGROUND_SUBAGENT_STRIP_ROWS: PlaygroundSubagentStripRow[] = [
  {
    sessionLinkId: "link-haiku-session-lifecycle",
    childSessionId: "298c62c7-b359-4cc7-a65e-b297ebabce2f",
    label: "session-lifecycle",
    statusLabel: "Idle",
    latestCompletionLabel: "Completed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-sonnet-cloud-auth",
    childSessionId: "67aa6956-3cfb-4b7c-a2ea-faf470f2e74e",
    label: "cloud-auth",
    statusLabel: "Idle",
    latestCompletionLabel: null,
    wakeScheduled: true,
  },
  {
    sessionLinkId: "link-codex-server-routes",
    childSessionId: "8cfbaa2a-404e-4dac-ad04-25b8a066a514",
    label: "server-routes",
    statusLabel: "Idle",
    latestCompletionLabel: "Completed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-codex-cicd",
    childSessionId: "0d3f015b-5de1-4984-badd-d1a0f022947f",
    label: "ci-cd",
    statusLabel: "Idle",
    latestCompletionLabel: "Completed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-gemini-pro-mcp-catalog",
    childSessionId: "354f014b-886a-4957-b315-f99e1c07ede4",
    label: "mcp-catalog",
    statusLabel: "Failed",
    latestCompletionLabel: "Failed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-gemini-flash-sdk",
    childSessionId: "9d817b15-eda5-43a8-9141-d7db85993c45",
    label: "sdk-surface",
    statusLabel: "Working",
    latestCompletionLabel: null,
    wakeScheduled: true,
  },
  {
    sessionLinkId: "link-opencode-cloud-runtime",
    childSessionId: "7c9d7648-0041-440e-85b1-17de9e2b70d8",
    label: "cloud-runtime",
    statusLabel: "Working",
    latestCompletionLabel: null,
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-cursor-tauri-commands",
    childSessionId: "a1124490-6516-4b52-a5f4-fde1eee57c2d",
    label: "tauri-commands",
    statusLabel: "Idle",
    latestCompletionLabel: "Completed turn",
    wakeScheduled: false,
  },
  {
    sessionLinkId: "link-runtime-server-sdk-survey",
    childSessionId: "b5870e25-f4f7-a08b-61d6e703177b",
    label: "runtime-server-sdk-survey",
    statusLabel: "Working",
    latestCompletionLabel: null,
    wakeScheduled: true,
  },
  {
    sessionLinkId: "link-frontend-repo-survey",
    childSessionId: "03ff96b2-9ca2-4df7-9296-c3b5146dfc6a",
    label: "frontend-repo-survey",
    statusLabel: "Working",
    latestCompletionLabel: null,
    wakeScheduled: true,
  },
];

export const PLAYGROUND_SUBAGENT_WAKE_QUEUE: PendingPromptQueueEntry[] = [{
  seq: 7,
  text: [
    'Subagent "runtime-server-sdk-survey" completed a turn.',
    "",
    "Child session: b5870e25-f4f7-a08b-61d6e703177b",
    "Session link: link-runtime-server-sdk-survey",
    "Outcome: completed",
    "Last child event seq: 184",
    "",
    "Use the subagent tools to inspect the child session before continuing.",
  ].join("\n"),
  contentParts: [],
  isBeingEdited: false,
  promptProvenance: {
    type: "subagentWake",
    sessionLinkId: "link-runtime-server-sdk-survey",
    completionId: "completion-runtime-server-sdk-survey",
    label: "runtime-server-sdk-survey",
  },
}];

export type PlaygroundReviewComposerStatus =
  | "Starting"
  | "Reviewing"
  | "Requests changes"
  | "Approved"
  | "Failed";

export interface PlaygroundReviewComposerRow {
  id: string;
  label: string;
  detail: string | null;
  status: PlaygroundReviewComposerStatus;
  hasCritique: boolean;
}

export interface PlaygroundReviewComposerState {
  summary: {
    label: string;
    detail: string | null;
    active: boolean;
  };
  rows: PlaygroundReviewComposerRow[];
  deliveryLabel: string | null;
  actionLabel: string | null;
}

export const PLAYGROUND_REVIEW_COMPOSER_STATES: Record<string, PlaygroundReviewComposerState> = {
  "subagents-review-starting-plan": {
    summary: {
      label: "3 agents reviewing plan",
      detail: "Plan review · round 1/2",
      active: true,
    },
    rows: [
      { id: "architecture", label: "Architecture reviewer", detail: null, status: "Starting", hasCritique: false },
      { id: "ux", label: "UX reviewer", detail: null, status: "Starting", hasCritique: false },
      { id: "risk", label: "Risk reviewer", detail: null, status: "Starting", hasCritique: false },
    ],
    deliveryLabel: null,
    actionLabel: null,
  },
  "subagents-review-starting-code": {
    summary: {
      label: "2 agents reviewing code",
      detail: "Code review · round 1/2",
      active: true,
    },
    rows: [
      { id: "correctness", label: "Correctness reviewer", detail: null, status: "Starting", hasCritique: false },
      { id: "product", label: "Product reviewer", detail: null, status: "Starting", hasCritique: false },
    ],
    deliveryLabel: null,
    actionLabel: null,
  },
  "subagents-reviewing-plan": {
    summary: {
      label: "3 agents reviewing plan",
      detail: "Plan review · 1/3",
      active: true,
    },
    rows: [
      { id: "architecture", label: "Architecture reviewer", detail: null, status: "Reviewing", hasCritique: false },
      {
        id: "ux",
        label: "UX reviewer",
        detail: "Navigation state needs a single selected-workspace owner.",
        status: "Requests changes",
        hasCritique: true,
      },
      { id: "risk", label: "Risk reviewer", detail: null, status: "Reviewing", hasCritique: false },
    ],
    deliveryLabel: null,
    actionLabel: null,
  },
  "subagents-reviewing-code": {
    summary: {
      label: "2 review agents reviewing code",
      detail: "Code review · 1/2",
      active: true,
    },
    rows: [
      { id: "security", label: "Security reviewer", detail: null, status: "Reviewing", hasCritique: false },
      {
        id: "ux",
        label: "UX reviewer",
        detail: "Approval copy should not compete with the composer controls.",
        status: "Requests changes",
        hasCritique: true,
      },
    ],
    deliveryLabel: null,
    actionLabel: null,
  },
  "subagents-review-feedback-ready": {
    summary: {
      label: "3 agents critiqued plan",
      detail: "Feedback ready · 3/3",
      active: true,
    },
    rows: [
      {
        id: "architecture",
        label: "Architecture reviewer",
        detail: "Plan needs a clearer state owner before implementation.",
        status: "Requests changes",
        hasCritique: true,
      },
      {
        id: "ux",
        label: "UX reviewer",
        detail: "Reduce duplicate review controls in the composer.",
        status: "Requests changes",
        hasCritique: true,
      },
      {
        id: "risk",
        label: "Risk reviewer",
        detail: "No blocking workflow risk found.",
        status: "Approved",
        hasCritique: true,
      },
    ],
    deliveryLabel: "Feedback is ready to send back to the parent agent.",
    actionLabel: "Send feedback",
  },
  "subagents-review-complete": {
    summary: {
      label: "3 agents approved plan",
      detail: "Passed · 3/3",
      active: false,
    },
    rows: [
      {
        id: "architecture",
        label: "Architecture reviewer",
        detail: "State ownership is clear.",
        status: "Approved",
        hasCritique: true,
      },
      {
        id: "ux",
        label: "UX reviewer",
        detail: "Composer flow is ready.",
        status: "Approved",
        hasCritique: true,
      },
      {
        id: "risk",
        label: "Risk reviewer",
        detail: "No blocking workflow risk found.",
        status: "Approved",
        hasCritique: true,
      },
    ],
    deliveryLabel: "All reviewers approved the latest revision.",
    actionLabel: "Dismiss",
  },
};

export const PLAYGROUND_REVIEW_FEEDBACK_ASSIGNMENTS: ReviewAssignmentDetail[] = [
  reviewAssignmentFixture({
    id: "security-reviewer",
    personaLabel: "Security reviewer",
    pass: true,
    summary: "No auth or data exposure regressions found.",
  }),
  reviewAssignmentFixture({
    id: "ux-reviewer",
    personaLabel: "UX reviewer",
    pass: false,
    summary: "Approval copy should not compete with the composer controls.",
  }),
  reviewAssignmentFixture({
    id: "integration-reviewer",
    personaLabel: "Integration reviewer",
    pass: false,
    summary: "Keep the review state derived from server runs.",
  }),
];

export const PLAYGROUND_REVIEW_COMPLETE_ASSIGNMENTS: ReviewAssignmentDetail[] = [
  reviewAssignmentFixture({
    id: "architecture-reviewer",
    personaLabel: "Architecture reviewer",
    pass: true,
    summary: "State ownership is clear.",
  }),
  reviewAssignmentFixture({
    id: "risk-reviewer",
    personaLabel: "Risk reviewer",
    pass: true,
    summary: "No blocking workflow risk found.",
  }),
  reviewAssignmentFixture({
    id: "product-reviewer",
    personaLabel: "Product reviewer",
    pass: true,
    summary: "The revised flow matches the requested behavior.",
  }),
];

function reviewAssignmentFixture(
  overrides: Partial<ReviewAssignmentDetail> & Pick<ReviewAssignmentDetail, "id" | "personaLabel">,
): ReviewAssignmentDetail {
  const { id, personaLabel, ...rest } = overrides;
  return {
    actualModeId: null,
    agentKind: "codex",
    createdAt: "2026-04-29T00:00:00Z",
    critiqueArtifactPath: null,
    deadlineAt: "2026-04-29T00:10:00Z",
    failureDetail: null,
    failureReason: null,
    hasCritique: true,
    id,
    modeVerificationStatus: "verified",
    modelId: "gpt-5.4",
    pass: true,
    personaId: id,
    personaLabel,
    requestedModeId: null,
    reviewRoundId: "review-round",
    reviewRunId: "review-run",
    reviewerSessionId: "reviewer-session",
    sessionLinkId: "session-link",
    status: "submitted",
    summary: null,
    updatedAt: "2026-04-29T00:05:00Z",
    ...rest,
  };
}

export const PLAYGROUND_SUBAGENT_WAKE_TRANSCRIPT: TranscriptState = {
  sessionMeta: {
    sessionId: "playground-subagent-wake",
    title: "Parent delegation session",
    updatedAt: "2026-04-21T02:34:00Z",
    nativeSessionId: null,
    sourceAgentKind: "codex",
  },
  turnOrder: ["turn-subagent-wake"],
  turnsById: {
    "turn-subagent-wake": {
      turnId: "turn-subagent-wake",
      itemOrder: ["assistant-before-wake", "scheduled-wake-message"],
      startedAt: "2026-04-21T02:31:45Z",
      completedAt: "2026-04-21T02:34:00Z",
      stopReason: "end_turn",
      fileBadges: [],
    },
  },
  itemsById: {
    "assistant-before-wake": {
      kind: "assistant_prose",
      itemId: "assistant-before-wake",
      turnId: "turn-subagent-wake",
      status: "completed",
      sourceAgentKind: "codex",
      messageId: null,
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      timestamp: "2026-04-21T02:31:45Z",
      startedSeq: 1,
      lastUpdatedSeq: 1,
      completedSeq: 1,
      completedAt: "2026-04-21T02:31:45Z",
      text: "I scheduled a wake for the runtime survey child and continued the main investigation.",
      isStreaming: false,
    },
    "scheduled-wake-message": {
      kind: "user_message",
      itemId: "scheduled-wake-message",
      turnId: "turn-subagent-wake",
      status: "completed",
      sourceAgentKind: "system",
      messageId: null,
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      timestamp: "2026-04-21T02:34:00Z",
      startedSeq: 9,
      lastUpdatedSeq: 9,
      completedSeq: 9,
      completedAt: "2026-04-21T02:34:00Z",
      text: PLAYGROUND_SUBAGENT_WAKE_QUEUE[0].text,
      isStreaming: false,
      promptProvenance: PLAYGROUND_SUBAGENT_WAKE_QUEUE[0].promptProvenance,
    },
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
  lastSeq: 10,
  pendingPrompts: [],
  linkCompletionsByCompletionId: {
    "completion-runtime-server-sdk-survey": {
      relation: "subagent",
      completionId: "completion-runtime-server-sdk-survey",
      sessionLinkId: "link-runtime-server-sdk-survey",
      parentSessionId: "playground-subagent-wake",
      childSessionId: "b5870e25-f4f7-a08b-61d6e703177b",
      childTurnId: "turn-runtime-server-sdk-survey",
      childLastEventSeq: 184,
      outcome: "completed",
      label: "runtime-server-sdk-survey",
      seq: 8,
      timestamp: "2026-04-21T02:33:58Z",
    },
  },
  latestLinkCompletionBySessionLinkId: {
    "link-runtime-server-sdk-survey": "completion-runtime-server-sdk-survey",
  },
};

export const EXECUTE_OPTIONS: PermissionOptionAction[] = [
  { optionId: "allow_always", label: "Always Allow", kind: "allow_always" },
  { optionId: "allow", label: "Allow", kind: "allow_once" },
  { optionId: "reject", label: "Reject", kind: "reject_once" },
];

export const EDIT_OPTIONS: PermissionOptionAction[] = [
  { optionId: "allow_always", label: "Always Allow", kind: "allow_always" },
  { optionId: "allow", label: "Allow", kind: "allow_once" },
  { optionId: "reject", label: "Reject", kind: "reject_once" },
];

export const GEMINI_MCP_OPTIONS: PermissionOptionAction[] = [
  {
    optionId: "proceed_always_server",
    label: "Allow all server tools for this session",
    kind: "allow_always",
  },
  {
    optionId: "proceed_always_tool",
    label: "Allow tool for this session",
    kind: "allow_always",
  },
  {
    optionId: "proceed_always_and_save",
    label: "Allow tool for all future sessions",
    kind: "allow_always",
  },
  { optionId: "proceed_once", label: "Allow", kind: "allow_once" },
  { optionId: "cancel", label: "Reject", kind: "reject_once" },
];

export const PLAN_OPTIONS: PermissionOptionAction[] = [
  { optionId: "bypassPermissions", label: "Yes, and bypass permissions", kind: "allow_always" },
  { optionId: "acceptEdits", label: "Yes, and auto-accept edits", kind: "allow_always" },
  { optionId: "default", label: "Yes, and manually approve edits", kind: "allow_once" },
  { optionId: "plan", label: "No, keep planning", kind: "reject_once" },
];

export const PENDING_PROMPTS_SINGLE: PendingPromptQueueEntry[] = [
  { seq: 1, text: "now please make fixes!", contentParts: [], isBeingEdited: false },
];

export const PENDING_PROMPTS_MULTI: PendingPromptQueueEntry[] = [
  { seq: 1, text: "now please make fixes!", contentParts: [], isBeingEdited: false },
  { seq: 2, text: "and rerun the server test suite after", contentParts: [], isBeingEdited: false },
  {
    seq: 3,
    text: "finally, bump the desktop version and cut a release — this text is intentionally long so we can see how overflow truncation behaves inside the queue row",
    contentParts: [],
    isBeingEdited: false,
  },
];

export const PENDING_PROMPTS_WITH_EDITING: PendingPromptQueueEntry[] = [
  { seq: 1, text: "now please make fixes!", contentParts: [], isBeingEdited: true },
  { seq: 2, text: "and rerun the server test suite after", contentParts: [], isBeingEdited: false },
];

export const PENDING_REVIEW_FEEDBACK_READY: PendingPromptQueueEntry[] = [{
  seq: 8,
  text: [
    "Review feedback is ready.",
    "",
    "Review run: review-run-ready",
    "Round: 1",
    "Target: plan",
    "",
    "Address the feedback you agree with, ignore feedback you can justify ignoring, and finish the revised target normally.",
    "",
    "## Reviewer",
    "Status: submitted",
    "Pass: false",
    "",
    "Summary:",
    "Hidden critique body that should not render in the composer queue.",
  ].join("\n"),
  contentParts: [],
  isBeingEdited: false,
  promptProvenance: {
    type: "reviewFeedback",
    reviewRunId: "review-run-ready",
    reviewRoundId: "review-round-ready",
    feedbackJobId: "feedback-job-ready",
  },
}];

export const PENDING_REVIEW_COMPLETE: PendingPromptQueueEntry[] = [{
  seq: 9,
  text: [
    "Review is complete.",
    "",
    "Review run: review-run-complete",
    "Round: 2",
    "Target: plan",
    "",
    "All reviewers approved. Use the final reviewer feedback below to present the final plan.",
    "",
    "## Reviewer",
    "Status: submitted",
    "Pass: true",
    "",
    "Summary:",
    "Final hidden reviewer note that should not render in the composer queue.",
  ].join("\n"),
  contentParts: [],
  isBeingEdited: false,
  promptProvenance: {
    type: "reviewFeedback",
    reviewRunId: "review-run-complete",
    reviewRoundId: "review-round-complete",
    feedbackJobId: "feedback-job-complete",
  },
}];

export const USER_INPUT_SINGLE_OPTION: UserInputQuestion[] = [{
  questionId: "provider",
  header: "Choose provider",
  question: "Which model provider should this workspace use?",
  isOther: false,
  isSecret: false,
  options: [
    { label: "OpenAI", description: "Use the default OpenAI-backed model stack." },
    { label: "Anthropic", description: "Use the Claude-backed model stack." },
  ],
}];

export const USER_INPUT_SINGLE_FREEFORM: UserInputQuestion[] = [{
  questionId: "workspace_name",
  header: "Name workspace",
  question: "What should the new worktree workspace be called?",
  isOther: false,
  isSecret: false,
  options: [],
}];

export const USER_INPUT_OPTION_PLUS_OTHER: UserInputQuestion[] = [{
  questionId: "strategy",
  header: "Pick a strategy",
  question: "How should the agent proceed with the migration?",
  isOther: true,
  isSecret: false,
  options: [
    { label: "Small safe patch", description: "Keep scope narrow and verify quickly." },
    { label: "Full refactor", description: "Take the whole subsystem in one pass." },
  ],
}];

export const USER_INPUT_SECRET: UserInputQuestion[] = [{
  questionId: "api_key",
  header: "Provide secret",
  question: "Paste the API key needed for this local verification step.",
  isOther: false,
  isSecret: true,
  options: [],
}];

export const USER_INPUT_MULTI_QUESTION: UserInputQuestion[] = [
  {
    questionId: "workspace",
    header: "Workspace",
    question: "Where should the agent run the next task?",
    isOther: false,
    isSecret: false,
    options: [
      { label: "Local worktree", description: "Use the current local checkout." },
      { label: "Cloud workspace", description: "Launch in the hosted runtime." },
    ],
  },
  {
    questionId: "notes",
    header: "Extra context",
    question: "Any extra constraints for the follow-up session?",
    isOther: false,
    isSecret: false,
    options: [],
  },
];

export const MCP_ELICITATION_BOOLEAN: McpElicitationInteractionPayload = {
  serverName: "Linear MCP",
  mode: {
    mode: "form",
    message: "Confirm whether this issue should be marked as triaged.",
    fields: [{
      fieldType: "boolean",
      fieldId: "field_1",
      label: "Mark issue as triaged",
      required: false,
    }],
  },
};

export const MCP_ELICITATION_ENUM: McpElicitationInteractionPayload = {
  serverName: "GitHub MCP",
  mode: {
    mode: "form",
    message: "Choose the review disposition for this pull request.",
    fields: [{
      fieldType: "single_select",
      fieldId: "field_1",
      label: "Disposition",
      required: true,
      options: [
        { optionId: "option_1", label: "Approve" },
        { optionId: "option_2", label: "Request changes" },
        { optionId: "option_3", label: "Comment only" },
      ],
    }],
  },
};

export const MCP_ELICITATION_MULTI_SELECT: McpElicitationInteractionPayload = {
  serverName: "Calendar MCP",
  mode: {
    mode: "form",
    message: "Select which calendars should be included in the search.",
    fields: [{
      fieldType: "multi_select",
      fieldId: "field_1",
      label: "Calendars",
      description: "Pick one or more calendars for this request.",
      required: true,
      minItems: 1,
      maxItems: 2,
      options: [
        { optionId: "option_1", label: "Personal" },
        { optionId: "option_2", label: "Work" },
        { optionId: "option_3", label: "Product launches" },
      ],
    }],
  },
};

export const MCP_ELICITATION_MIXED_REQUIRED: McpElicitationInteractionPayload = {
  serverName: "Docs MCP",
  mode: {
    mode: "form",
    message: "Provide the metadata needed to publish this generated doc.",
    fields: [
      {
        fieldType: "text",
        fieldId: "field_1",
        label: "Document title",
        required: true,
        maxLength: 80,
      },
      {
        fieldType: "number",
        fieldId: "field_2",
        label: "Review priority",
        required: true,
        integer: true,
        minimum: "1",
        maximum: "5",
      },
      {
        fieldType: "single_select",
        fieldId: "field_3",
        label: "Visibility",
        required: true,
        options: [
          { optionId: "option_1", label: "Private" },
          { optionId: "option_2", label: "Workspace" },
        ],
      },
    ],
  },
};

export const MCP_ELICITATION_URL: McpElicitationInteractionPayload = {
  serverName: "OAuth MCP",
  mode: {
    mode: "url",
    message: "Open the provider authorization URL to continue.",
    urlDisplay: "https://accounts.example.com",
    requiresReveal: true,
  },
};

function toolCallItem(overrides: Partial<ToolCallItem>): ToolCallItem {
  return {
    kind: "tool_call",
    itemId: "tool-playground",
    turnId: "turn-subagent",
    status: "completed",
    sourceAgentKind: "codex",
    messageId: null,
    title: "Tool call",
    nativeToolName: "Tool",
    parentToolCallId: null,
    rawInput: undefined,
    rawOutput: undefined,
    contentParts: [],
    timestamp: "2026-04-12T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 2,
    completedAt: "2026-04-12T00:00:01Z",
    toolCallId: "tool-playground",
    toolKind: "other",
    semanticKind: "other",
    approvalState: "none",
    ...overrides,
  } as ToolCallItem;
}
