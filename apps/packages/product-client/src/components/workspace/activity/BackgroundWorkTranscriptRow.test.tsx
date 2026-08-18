/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundWorkTranscriptRow } from "./BackgroundWorkTranscriptRow";

afterEach(() => {
  cleanup();
});

const PROLIFERATE_MARK_SELECTOR = 'svg[viewBox="300 300 200 200"]';
const CIRCLE_CHECK_SELECTOR = 'svg[viewBox="0 0 24 24"]';

describe("BackgroundWorkTranscriptRow", () => {
  // Founder ruling (bgwork r6): the row counts RUNNING work only and is not
  // rendered at count 0. Completed tasks leave the count; the row disappears
  // at 0. There is no settled/finished display state — completed work is
  // announced solely by the inline `BackgroundCompletionReceipt` rows.
  it("renders nothing when nothing is running", () => {
    const { container } = render(
      <BackgroundWorkTranscriptRow runningCount={0} onOpen={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the singular running copy", () => {
    render(<BackgroundWorkTranscriptRow runningCount={1} onOpen={() => {}} />);
    expect(screen.getByText("1 background task")).toBeTruthy();
  });

  it("renders the plural running copy", () => {
    render(<BackgroundWorkTranscriptRow runningCount={3} onOpen={() => {}} />);
    expect(screen.getByText("3 background tasks")).toBeTruthy();
  });

  it("renders the static Proliferate mark while running, never CircleCheck", () => {
    const { container } = render(
      <BackgroundWorkTranscriptRow runningCount={2} onOpen={() => {}} />,
    );
    expect(container.querySelector(PROLIFERATE_MARK_SELECTOR)).toBeTruthy();
    expect(container.querySelector(CIRCLE_CHECK_SELECTOR)).toBeNull();
  });

  it("rests at text-muted-foreground and shares one hover treatment between glyph and label", () => {
    const { container } = render(
      <BackgroundWorkTranscriptRow runningCount={1} onOpen={() => {}} />,
    );
    const label = screen.getByText("1 background task");
    const glyphWrapper = container.querySelector(PROLIFERATE_MARK_SELECTOR)?.parentElement;
    for (const el of [label, glyphWrapper]) {
      const classNames = el?.className.split(" ") ?? [];
      expect(classNames).toContain("group-hover:text-foreground");
      expect(classNames).toContain("transition-colors");
      expect(classNames).toContain("duration-hover");
    }
    expect(label.className.split(" ")).toContain("text-muted-foreground");
  });

  it("carries no motion class", () => {
    const { container } = render(
      <BackgroundWorkTranscriptRow runningCount={1} onOpen={() => {}} />,
    );
    expect(container.innerHTML).not.toMatch(/animate-|motion-safe:/);
  });

  it("fires onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(<BackgroundWorkTranscriptRow runningCount={1} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "1 background task" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // NEGATIVE CONTROL: the removed settled state is gone in every arrangement —
  // no "finished" copy, no CircleCheck glyph, and no `text-faint` settled tone,
  // whether running is positive or zero.
  it("never renders the removed settled state (no finished copy, no CircleCheck, no text-faint)", () => {
    const running = render(
      <BackgroundWorkTranscriptRow runningCount={2} onOpen={() => {}} />,
    );
    expect(running.container.textContent).not.toMatch(/finished/i);
    expect(running.container.querySelector(CIRCLE_CHECK_SELECTOR)).toBeNull();
    expect(running.container.innerHTML).not.toContain("text-faint");
    cleanup();

    // At zero running, the row is absent entirely — the old code would have
    // shown "N background tasks finished" here.
    const zero = render(<BackgroundWorkTranscriptRow runningCount={0} onOpen={() => {}} />);
    expect(zero.container.firstChild).toBeNull();
    expect(screen.queryByText(/finished/i)).toBeNull();
  });
});
