// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ContentPart } from "@anyharness/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAN_IMPLEMENT_HERE_PROMPT,
  PLAN_IMPLEMENT_HERE_ROW_LABEL,
} from "@/copy/plans/plan-prompts";
import { UserMessage } from "./UserMessage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it("uses the long transcript clamp and reveals actions from keyboard focus", () => {
    const { container } = render(
      <UserMessage
        sessionId="session-1"
        content="A normal prompt"
        showCopyButton
      />,
    );

    const bubble = container.querySelector<HTMLElement>(".chat-user-message-bubble");
    expect(bubble).not.toBeNull();
    expect(bubble?.tabIndex).toBe(0);
    expect(bubble?.className).toContain("focus-visible:ring-2");
    expect((bubble?.firstElementChild as HTMLElement | null)?.style.maxHeight).toBe("19lh");
    expect(container.innerHTML).toContain("group-focus-within/msg:opacity-100");
  });

  it("renders prompt markdown with the compact user-message list rhythm", () => {
    const { container } = render(
      <UserMessage
        sessionId="session-1"
        content={"A list:\n\n- First\n- Second"}
      />,
    );

    expect(container.querySelectorAll("li")).toHaveLength(2);
    const markdown = container.querySelector("ul")?.parentElement;
    expect(markdown?.className).toContain("[&_li+li]:!mt-0");
    expect(markdown?.className).toContain("[&_ul]:!pl-6");
  });

  it("remeasures clamped overflow with a rounding tolerance", () => {
    let scrollHeight = 102;
    const clientHeight = 100;
    let resizeCallback: ResizeObserverCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();

    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(() => scrollHeight);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(() => clientHeight);
    vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(
      (callback: ResizeObserverCallback) => {
        resizeCallback = callback;
        return { observe, unobserve: vi.fn(), disconnect };
      },
    ));

    const { container, queryByRole, getByRole } = render(
      <UserMessage sessionId="session-1" content="A prompt that may wrap" />,
    );

    expect(observe).toHaveBeenCalled();
    expect(queryByRole("button", { name: "Show more" })).toBeNull();

    act(() => {
      scrollHeight = 103;
      resizeCallback?.([], {} as ResizeObserver);
    });

    fireEvent.click(getByRole("button", { name: "Show more" }));
    expect(getByRole("button", { name: "Show less" })).toBeTruthy();
    expect(
      (container.querySelector(".chat-user-message-bubble")?.firstElementChild as HTMLElement)
        .style.maxHeight,
    ).toBe("");
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
