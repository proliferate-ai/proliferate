import type { McpElicitationInteractionPayload, PlanEntry, UserInputQuestion } from "@anyharness/sdk";
import type { PendingPromptListEntry } from "@/components/workspace/chat/input/PendingPromptList";
import type { PermissionOptionAction } from "@/lib/domain/chat/chat-input-helpers";

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
  { content: "Move Claude plan body into the transcript as ClaudePlanCard", status: "pending" },
  { content: "Intercept Claude ExitPlanMode in MessageList dispatch", status: "pending" },
  { content: "Update ChatView single-slot precedence (approval > todos > workspace > cloud)", status: "pending" },
  { content: "Add fade-mask CSS utility to index.css", status: "pending" },
  { content: "Rebase onto main and verify typecheck + tests pass", status: "pending" },
  { content: "Write a playground page so UI iteration doesn't require an LLM", status: "pending" },
];

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
