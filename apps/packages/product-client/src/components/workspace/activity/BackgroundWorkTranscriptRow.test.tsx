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
  it("renders nothing when nothing is running and nothing finished", () => {
    const { container } = render(
      <BackgroundWorkTranscriptRow runningCount={0} finishedCount={0} onOpen={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the singular running copy", () => {
    render(<BackgroundWorkTranscriptRow runningCount={1} finishedCount={0} onOpen={() => {}} />);
    expect(screen.getByText("1 background task")).toBeTruthy();
  });

  it("renders the plural running copy", () => {
    render(<BackgroundWorkTranscriptRow runningCount={3} finishedCount={0} onOpen={() => {}} />);
    expect(screen.getByText("3 background tasks")).toBeTruthy();
  });

  it("renders the static Proliferate mark while running, not CircleCheck", () => {
    const { container } = render(
      <BackgroundWorkTranscriptRow runningCount={2} finishedCount={0} onOpen={() => {}} />,
    );
    expect(container.querySelector(PROLIFERATE_MARK_SELECTOR)).toBeTruthy();
    expect(container.querySelector(CIRCLE_CHECK_SELECTOR)).toBeNull();
  });

  it("renders the settled copy, pluralized, once the running count is zero", () => {
    render(<BackgroundWorkTranscriptRow runningCount={0} finishedCount={2} onOpen={() => {}} />);
    expect(screen.getByText("2 background tasks finished")).toBeTruthy();
  });

  it("renders the singular settled copy", () => {
    render(<BackgroundWorkTranscriptRow runningCount={0} finishedCount={1} onOpen={() => {}} />);
    expect(screen.getByText("1 background task finished")).toBeTruthy();
  });

  it("swaps the glyph to CircleCheck once settled, and rests at text-faint", () => {
    const { container } = render(
      <BackgroundWorkTranscriptRow runningCount={0} finishedCount={1} onOpen={() => {}} />,
    );
    expect(container.querySelector(CIRCLE_CHECK_SELECTOR)).toBeTruthy();
    expect(container.querySelector(PROLIFERATE_MARK_SELECTOR)).toBeNull();
    const label = screen.getByText("1 background task finished");
    expect(label.className.split(" ")).toContain("text-faint");
  });

  it("shares one hover treatment between the glyph wrapper and the label", () => {
    const { container } = render(
      <BackgroundWorkTranscriptRow runningCount={1} finishedCount={0} onOpen={() => {}} />,
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

  it("carries no motion class in the running state", () => {
    const { container } = render(
      <BackgroundWorkTranscriptRow runningCount={1} finishedCount={0} onOpen={() => {}} />,
    );
    expect(container.innerHTML).not.toMatch(/animate-|motion-safe:/);
  });

  it("carries no motion class in the settled state", () => {
    const { container } = render(
      <BackgroundWorkTranscriptRow runningCount={0} finishedCount={1} onOpen={() => {}} />,
    );
    expect(container.innerHTML).not.toMatch(/animate-|motion-safe:/);
  });

  it("fires onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(<BackgroundWorkTranscriptRow runningCount={1} finishedCount={0} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "1 background task" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
