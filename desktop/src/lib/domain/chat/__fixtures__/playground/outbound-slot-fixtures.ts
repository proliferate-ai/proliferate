import type { PendingPromptQueueEntry } from "@proliferate/product-model/chats/pending-prompts/pending-prompt-queue";

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
