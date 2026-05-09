import type { SearchWorkspaceFilesResponse } from "@anyharness/sdk";

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
