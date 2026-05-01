import { describe, expect, it } from "vitest";
import type { ContentPart } from "@anyharness/sdk";
import {
  derivePendingPromptQueueRow,
  type PendingPromptQueueEntry,
} from "./pending-prompt-queue";

function entry(overrides: Partial<PendingPromptQueueEntry> = {}): PendingPromptQueueEntry {
  return {
    seq: 1,
    text: "Queued text",
    contentParts: [],
    isBeingEdited: false,
    promptProvenance: null,
    ...overrides,
  };
}

describe("derivePendingPromptQueueRow", () => {
  it("derives editable plain text rows with collapsed whitespace", () => {
    expect(derivePendingPromptQueueRow(entry({
      text: "first line\n\nsecond line",
    }))).toMatchObject({
      seq: 1,
      kind: "plain",
      label: "first line second line",
      isBeingEdited: false,
      canEdit: true,
      canDelete: true,
    });
  });

  it("summarizes structured content and prevents editing", () => {
    const contentParts: ContentPart[] = [
      { type: "text", text: "Review these" },
      {
        type: "image",
        attachmentId: "image-1",
        mimeType: "image/png",
        name: "screenshot.png",
        size: 2048,
      },
      {
        type: "resource",
        attachmentId: "file-1",
        uri: "file:///README.md",
        name: "README.md",
        mimeType: "text/markdown",
        size: 1024,
        preview: "# Readme",
      },
      {
        type: "resource_link",
        uri: "https://example.com/spec",
        name: "spec",
        description: "Spec",
      },
      {
        type: "plan_reference",
        planId: "plan-1",
        title: "Implementation Plan",
        bodyMarkdown: "# Plan",
        snapshotHash: "hash-1",
        sourceSessionId: "session-1",
        sourceKind: "codex",
      },
    ];

    expect(derivePendingPromptQueueRow(entry({ contentParts, text: "" }))).toMatchObject({
      kind: "plain",
      label: "Review these [image: screenshot.png] [file: README.md] [link: spec] [plan: Implementation Plan]",
      canEdit: false,
      canDelete: true,
    });
  });

  it("hides subagent wake prompt bodies", () => {
    const row = derivePendingPromptQueueRow(entry({
      text: [
        'Subagent "runtime-server-sdk-survey" completed a turn.',
        "Child session: child-1",
        "Use the subagent tools to inspect the child session before continuing.",
      ].join("\n"),
      promptProvenance: {
        type: "subagentWake",
        sessionLinkId: "link-1",
        completionId: "completion-1",
        label: "runtime-server-sdk-survey",
      },
    }));

    expect(row).toMatchObject({
      kind: "wake",
      label: "runtime-server-sdk-survey finished",
      canEdit: false,
      canDelete: true,
    });
    expect(row.label).not.toContain("Child session");
  });

  it("formats review feedback ready rows from the first line", () => {
    const row = derivePendingPromptQueueRow(entry({
      text: "Review feedback is ready.\n\nHidden critique body",
      promptProvenance: {
        type: "reviewFeedback",
        reviewRunId: "run-1",
        reviewRoundId: "round-1",
        feedbackJobId: "job-1",
      },
    }));

    expect(row).toMatchObject({
      kind: "review_feedback",
      label: "Review feedback ready",
      canEdit: false,
      canDelete: true,
    });
    expect(row.label).not.toContain("Hidden critique");
  });

  it("formats review complete rows from the first line", () => {
    expect(derivePendingPromptQueueRow(entry({
      text: "Review is complete.\n\nAll reviewers approved",
      promptProvenance: {
        type: "reviewFeedback",
        reviewRunId: "run-1",
        reviewRoundId: "round-2",
        feedbackJobId: "job-2",
      },
    }))).toMatchObject({
      kind: "review_feedback",
      label: "Review complete",
    });
  });

  it("prefers review provenance labels", () => {
    expect(derivePendingPromptQueueRow(entry({
      text: "Review feedback is ready.\n\nHidden critique body",
      promptProvenance: {
        type: "reviewFeedback",
        reviewRunId: "run-1",
        reviewRoundId: "round-1",
        feedbackJobId: "job-1",
        label: "Reviewer notes ready",
      },
    }))).toMatchObject({
      kind: "review_feedback",
      label: "Reviewer notes ready",
    });
  });

  it("supports legacy review feedback provenance", () => {
    expect(derivePendingPromptQueueRow(entry({
      text: "Review feedback is ready.\n\nReview run: run-1\nRound: 1",
      promptProvenance: {
        type: "system",
        label: "review_feedback",
      },
    }))).toMatchObject({
      kind: "review_feedback",
      label: "Review feedback ready",
    });
  });

  it("falls back for unknown review feedback text", () => {
    expect(derivePendingPromptQueueRow(entry({
      text: "Unexpected first line\n\nHidden critique body",
      promptProvenance: {
        type: "reviewFeedback",
        reviewRunId: "run-1",
        reviewRoundId: "round-1",
        feedbackJobId: "job-1",
      },
    }))).toMatchObject({
      kind: "review_feedback",
      label: "Review feedback ready",
    });
  });
});
