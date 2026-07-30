// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import { TypewriterRevealText } from "../src/primitives/TypewriterRevealText";

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("TypewriterRevealText", () => {
  it("types the label in on the first assignment and settles on the full text", () => {
    const { container, rerender } = render(
      <TypewriterRevealText text="Chat" revealOnFirstAssignment={false} />,
    );
    expect(container.textContent).toBe("Chat");

    rerender(<TypewriterRevealText text="Fix the spinner" revealOnFirstAssignment />);
    act(() => {
      vi.advanceTimersByTime(0);
    });

    const revealing = container.querySelector("[data-tab-name-revealing='true']");
    expect(revealing).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(motion.activity.tabNameRevealMs * 2);
    });
    expect(container.querySelector("[data-tab-name-revealing='true']")).toBeNull();
    expect(container.textContent).toBe("Fix the spinner");
  });

  it("does not re-run on a later rename", () => {
    const { container, rerender } = render(
      <TypewriterRevealText text="Chat" revealOnFirstAssignment={false} />,
    );
    rerender(<TypewriterRevealText text="First name" revealOnFirstAssignment />);
    act(() => {
      vi.advanceTimersByTime(motion.activity.tabNameRevealMs * 2);
    });

    rerender(<TypewriterRevealText text="Renamed later" revealOnFirstAssignment />);
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(container.querySelector("[data-tab-name-revealing='true']")).toBeNull();
    expect(container.textContent).toBe("Renamed later");
  });

  it("does not animate a label that is already assigned on mount", () => {
    const { container } = render(
      <TypewriterRevealText text="Restored session" revealOnFirstAssignment />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(container.querySelector("[data-tab-name-revealing='true']")).toBeNull();
    expect(container.textContent).toBe("Restored session");
  });

  it("skips the character clock under reduced motion", () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    const { container, rerender } = render(
      <TypewriterRevealText text="Chat" revealOnFirstAssignment={false} />,
    );
    rerender(<TypewriterRevealText text="Named now" revealOnFirstAssignment />);
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(container.querySelector("[data-tab-name-revealing='true']")).toBeNull();
    expect(container.textContent).toBe("Named now");
  });
});
