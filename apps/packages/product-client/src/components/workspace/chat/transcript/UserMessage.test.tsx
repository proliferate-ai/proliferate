// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ContentPart } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAN_IMPLEMENT_HERE_PROMPT,
  PLAN_IMPLEMENT_HERE_ROW_LABEL,
} from "#product/copy/plans/plan-prompts";
import { UserMessage } from "#product/components/workspace/chat/transcript/UserMessage";

vi.mock("#product/components/content/ui/FilePathLink", () => ({
  FilePathLink: ({ rawPath, children }: { rawPath: string; children?: ReactNode }) => (
    <span data-file-path-link={rawPath}>{children ?? rawPath}</span>
  ),
}));

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

  it("renders sent user prose as Markdown while preserving workspace file links", () => {
    const { container } = render(
      <UserMessage
        sessionId="session-1"
        content={"**Bold** and _italic_\n\n- first\n- second\n\n[Docs](https://example.com) and [file](src/main.ts)"}
        contentParts={[]}
      />,
    );

    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector('a[href="https://example.com"]')).toBeTruthy();
    expect(container.querySelector("[data-file-path-link]")?.textContent).toContain("file");
  });

  it("does not execute raw HTML or unsafe Markdown links", () => {
    const { container } = render(
      <UserMessage
        sessionId="session-1"
        content={'<script>alert("no")</script> [unsafe](javascript:alert(1))'}
        contentParts={[]}
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.textContent).toContain("<script>");
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
