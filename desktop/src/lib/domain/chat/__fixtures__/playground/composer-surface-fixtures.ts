import type { SearchWorkspaceFilesResponse } from "@anyharness/sdk";
import type { ModelSelectorProps } from "@/lib/domain/chat/models/model-selection";
import type { LiveSessionControlDescriptor } from "@/lib/domain/chat/session-controls/session-controls";

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

export function createPlaygroundModelSelectorProps(): ModelSelectorProps {
  return {
    connectionState: "healthy",
    currentModel: {
      kind: "codex",
      displayName: "GPT 5.5",
      pendingState: null,
    },
    groups: [
      {
        kind: "codex",
        providerDisplayName: "Proliferate",
        models: [
          {
            kind: "codex",
            modelId: "gpt-5.5",
            displayName: "GPT 5.5",
            actionKind: "select",
            isSelected: true,
          },
          {
            kind: "codex",
            modelId: "gpt-5.4",
            displayName: "GPT 5.4",
            actionKind: "select",
            isSelected: false,
          },
        ],
      },
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          {
            kind: "claude",
            modelId: "opus-4.1",
            displayName: "Opus 4.1",
            actionKind: "open_new_chat",
            isSelected: false,
          },
        ],
      },
    ],
    hasAgents: true,
    isLoading: false,
    notReadyAgents: [],
    onSelect: () => undefined,
  };
}

export function createPlaygroundSessionConfigControls(): LiveSessionControlDescriptor[] {
  return [
    {
      key: "collaboration_mode",
      label: "Mode",
      detail: "Default",
      rawConfigId: "collaboration_mode",
      settable: true,
      pendingState: null,
      kind: "select",
      options: [
        {
          value: "default",
          label: "Default",
          description: "Standard collaboration behavior.",
          selected: true,
        },
        {
          value: "plan",
          label: "Plan",
          description: "Plan before applying changes.",
          selected: false,
        },
      ],
      onSelect: () => undefined,
    },
    {
      key: "mode",
      label: "Permissions",
      detail: "Auto",
      rawConfigId: "mode",
      settable: true,
      pendingState: null,
      kind: "select",
      options: [
        {
          value: "read-only",
          label: "Read Only",
          description: "Inspect and plan without editing.",
          selected: false,
        },
        {
          value: "auto",
          label: "Auto",
          description: "Auto-approve standard edits.",
          selected: true,
        },
        {
          value: "full-access",
          label: "Full Access",
          description: "Allow unrestricted changes.",
          selected: false,
        },
      ],
      onSelect: () => undefined,
    },
    {
      key: "effort",
      label: "Reasoning effort",
      detail: "Xhigh",
      rawConfigId: "effort",
      settable: true,
      pendingState: null,
      kind: "select",
      options: [
        { value: "low", label: "Low", selected: false },
        { value: "medium", label: "Medium", selected: false },
        { value: "xhigh", label: "Extra High", selected: true },
      ],
      onSelect: () => undefined,
    },
    {
      key: "fast_mode",
      label: "Fast mode",
      detail: "On",
      rawConfigId: "fast_mode",
      settable: true,
      pendingState: null,
      kind: "toggle",
      enabledValue: "on",
      disabledValue: "off",
      isEnabled: true,
      options: [
        { value: "off", label: "Off", selected: false },
        { value: "on", label: "On", selected: true },
      ],
      onSelect: () => undefined,
    },
  ];
}
