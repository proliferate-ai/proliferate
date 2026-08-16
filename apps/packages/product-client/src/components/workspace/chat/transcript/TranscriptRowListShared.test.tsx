/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TranscriptFloatingControls,
  TranscriptScrollToBottomButton,
} from "./TranscriptRowListShared";

afterEach(() => {
  cleanup();
});

describe("TranscriptScrollToBottomButton", () => {
  it("hides the new-content dot when not visible, even if hasNewContent is true", () => {
    render(
      <TranscriptScrollToBottomButton
        visible={false}
        hasNewContent
        bottomInsetPx={0}
        onClick={vi.fn()}
      />,
    );
    expect(document.querySelector("[data-transcript-new-content-indicator]")).toBeNull();
  });

  it("shows no dot when visible but no new content", () => {
    render(
      <TranscriptScrollToBottomButton
        visible
        hasNewContent={false}
        bottomInsetPx={0}
        onClick={vi.fn()}
      />,
    );
    expect(document.querySelector("[data-transcript-new-content-indicator]")).toBeNull();
  });

  it("shows the dot when visible and new content arrived (Q18, rung 9)", () => {
    render(
      <TranscriptScrollToBottomButton
        visible
        hasNewContent
        bottomInsetPx={0}
        onClick={vi.fn()}
      />,
    );
    expect(document.querySelector("[data-transcript-new-content-indicator]")).not.toBeNull();
  });

  it("stays the same click target and aria-label with the dot showing", () => {
    const onClick = vi.fn();
    render(
      <TranscriptScrollToBottomButton
        visible
        hasNewContent
        bottomInsetPx={0}
        onClick={onClick}
      />,
    );
    screen.getByRole("button", { name: "Scroll to bottom" }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("TranscriptFloatingControls", () => {
  it("defaults hasNewContentWhileUnpinned to false when the caller omits it", () => {
    render(
      <TranscriptFloatingControls
        bottomInsetPx={0}
        isPinnedToBottom={false}
        onScrollToBottomClick={vi.fn()}
      />,
    );
    expect(document.querySelector("[data-transcript-new-content-indicator]")).toBeNull();
  });

  it("forwards hasNewContentWhileUnpinned to the button", () => {
    render(
      <TranscriptFloatingControls
        bottomInsetPx={0}
        isPinnedToBottom={false}
        hasNewContentWhileUnpinned
        onScrollToBottomClick={vi.fn()}
      />,
    );
    expect(document.querySelector("[data-transcript-new-content-indicator]")).not.toBeNull();
  });

  it("never shows the dot while pinned, even if the caller passes true", () => {
    render(
      <TranscriptFloatingControls
        bottomInsetPx={0}
        isPinnedToBottom
        hasNewContentWhileUnpinned
        onScrollToBottomClick={vi.fn()}
      />,
    );
    expect(document.querySelector("[data-transcript-new-content-indicator]")).toBeNull();
  });
});
