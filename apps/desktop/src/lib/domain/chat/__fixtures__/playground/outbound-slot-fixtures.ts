import type { PendingPromptQueueEntry } from "@proliferate/product-domain/chats/pending-prompts/pending-prompt-queue";

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
