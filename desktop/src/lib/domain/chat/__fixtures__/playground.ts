import type {
  CoworkArtifactSummary,
  McpElicitationInteractionPayload,
  PlanEntry,
  SearchWorkspaceFilesResponse,
  ToolCallItem,
  TranscriptState,
  UserInputQuestion,
} from "@anyharness/sdk";
import type { PendingPromptListEntry } from "@/components/workspace/chat/input/PendingPromptList";
import type { PermissionOptionAction } from "@/lib/domain/chat/chat-input-helpers";
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
    path: "docs/frontend/chat-composer.md",
  },
];

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
    status: "queued",
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    runtimeGeneration: 1,
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
  status: "starting_runtime",
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
  title: "Task: inspect compact rows",
  nativeToolName: "Agent",
  semanticKind: "subagent",
  contentParts: [
    {
      type: "tool_input_text",
      text: "Inspect the transcript rendering path and report whether nested tool calls use compact rows.",
    },
    {
      type: "tool_result_text",
      text: "Nested command and file-read rows now use the compact transcript action surface.",
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

export const PENDING_PROMPTS_SINGLE: PendingPromptListEntry[] = [
  { seq: 1, text: "now please make fixes!", isBeingEdited: false },
];

export const PENDING_PROMPTS_MULTI: PendingPromptListEntry[] = [
  { seq: 1, text: "now please make fixes!", isBeingEdited: false },
  { seq: 2, text: "and rerun the server test suite after", isBeingEdited: false },
  {
    seq: 3,
    text: "finally, bump the desktop version and cut a release — this text is intentionally long so we can see how overflow truncation behaves inside the queue row",
    isBeingEdited: false,
  },
];

export const PENDING_PROMPTS_WITH_EDITING: PendingPromptListEntry[] = [
  { seq: 1, text: "now please make fixes!", isBeingEdited: true },
  { seq: 2, text: "and rerun the server test suite after", isBeingEdited: false },
];

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
