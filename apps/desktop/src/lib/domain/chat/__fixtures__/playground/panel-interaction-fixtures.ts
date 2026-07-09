import type { McpElicitationInteractionPayload, UserInputQuestion } from "@anyharness/sdk";
import type { PermissionOptionAction } from "@/lib/domain/chat/composer/chat-input-helpers";

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

export const MCP_APPROVAL_OPTIONS: PermissionOptionAction[] = [
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
