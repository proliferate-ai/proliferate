// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { ContentPart } from "@anyharness/sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLAN_IMPLEMENT_HERE_PROMPT,
  PLAN_IMPLEMENT_HERE_ROW_LABEL,
} from "@/copy/plans/plan-prompts";
import { UserMessage } from "./UserMessage";

afterEach(() => {
  cleanup();
});

describe("UserMessage", () => {
  it("renders the canned carry-out prompt as a compact row with the plan chip", () => {
    const { container } = render(
      <UserMessage
        sessionId="session-1"
        content={PLAN_IMPLEMENT_HERE_PROMPT}
        contentParts={carryOutContentParts()}
      />,
    );

    expect(container.querySelector("[data-carry-out-plan-row]")).toBeTruthy();
    expect(container.textContent).toContain(PLAN_IMPLEMENT_HERE_ROW_LABEL);
    expect(container.textContent).toContain("Plan title");
    // No user bubble and no third copy of the plan body.
    expect(container.querySelector("[data-chat-user-message]")).toBeNull();
    expect(container.textContent).not.toContain(PLAN_IMPLEMENT_HERE_PROMPT);
    expect(container.textContent).not.toContain("Plan body markdown");
  });

  it("keeps the full bubble for the same text without a plan attachment", () => {
    const { container } = render(
      <UserMessage
        sessionId="session-1"
        content={PLAN_IMPLEMENT_HERE_PROMPT}
        contentParts={[{ type: "text", text: PLAN_IMPLEMENT_HERE_PROMPT }]}
      />,
    );

    expect(container.querySelector("[data-carry-out-plan-row]")).toBeNull();
    expect(container.querySelector("[data-chat-user-message]")).toBeTruthy();
    expect(container.textContent).toContain(PLAN_IMPLEMENT_HERE_PROMPT);
  });

  it("keeps the full bubble for ordinary prompts with plan attachments", () => {
    const { container } = render(
      <UserMessage
        sessionId="session-1"
        content="Please review the attached plan first."
        contentParts={[
          { type: "text", text: "Please review the attached plan first." },
          planReferencePart(),
        ]}
      />,
    );

    expect(container.querySelector("[data-carry-out-plan-row]")).toBeNull();
    expect(container.querySelector("[data-chat-user-message]")).toBeTruthy();
  });
});

function carryOutContentParts(): ContentPart[] {
  return [
    { type: "text", text: PLAN_IMPLEMENT_HERE_PROMPT },
    planReferencePart(),
  ];
}

function planReferencePart(): ContentPart {
  return {
    type: "plan_reference",
    planId: "plan-1",
    title: "Plan title",
    bodyMarkdown: "Plan body markdown",
    snapshotHash: "hash-1",
    sourceSessionId: "session-1",
    sourceTurnId: "turn-1",
    sourceItemId: "item-1",
    sourceKind: "proposed_plan",
    sourceToolCallId: null,
  } as ContentPart;
}
