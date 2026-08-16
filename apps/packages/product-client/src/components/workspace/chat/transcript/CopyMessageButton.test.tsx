// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import { CopyMessageButton } from "#product/components/workspace/chat/transcript/CopyMessageButton";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CopyMessageButton", () => {

  it("gives the button enough square clearance to avoid clipping the glyph", () => {
    const { container } = render(
      <CopyMessageButton content="Answer" visibilityClassName="opacity-100" />,
    );

    expect(container.querySelector("button")?.className).toContain("!size-icon-button-sm !p-0");
  });

  it("sizes the glyph to the transcript's icon-paired ratio", () => {
    const { container } = render(
      <CopyMessageButton content="Answer" visibilityClassName="opacity-100" />,
    );

    const glyphClassName = container.querySelector("button svg")?.getAttribute("class") ?? "";
    expect(glyphClassName).toContain("icon-paired");
    expect(glyphClassName).not.toContain("icon-control");
  });

  it("uses the tertiary foreground tone at rest, matching the adjacent date", () => {
    const { container } = render(
      <CopyMessageButton content="Answer" visibilityClassName="opacity-100" />,
    );

    expect(container.querySelector("button")?.className).toContain("!text-foreground-tertiary");
  });

  it("renders the timestamp before the copy button by default", () => {
    const { container } = render(
      <CopyMessageButton
        content="hello"
        timestampLabel="9:41 AM"
        visibilityClassName=""
      />,
    );

    const root = container.firstElementChild;
    expect(root?.children[0]?.tagName).toBe("SPAN");
    expect(root?.children[0]?.textContent).toBe("9:41 AM");
    expect(root?.children[1]?.tagName).toBe("BUTTON");
  });

  it("can render the copy button before the timestamp", () => {
    const { container } = render(
      <CopyMessageButton
        content="hello"
        timestampLabel="9:41 AM"
        timestampPosition="after"
        visibilityClassName=""
      />,
    );

    const root = container.firstElementChild;
    expect(root?.children[0]?.tagName).toBe("BUTTON");
    expect(root?.children[1]?.tagName).toBe("SPAN");
    expect(root?.children[1]?.textContent).toBe("9:41 AM");
  });

  it("reverts to the resting label motion.feedback.copiedResetMs after a copy", async () => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    const { container } = render(
      <CopyMessageButton content="Answer" visibilityClassName="opacity-100" />,
    );
    const button = container.querySelector("button") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(button.title).toBe("Copied");

    await act(async () => {
      vi.advanceTimersByTime(motion.feedback.copiedResetMs - 1);
    });
    expect(button.title).toBe("Copied");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(button.title).toBe("Copy message");
  });
});
