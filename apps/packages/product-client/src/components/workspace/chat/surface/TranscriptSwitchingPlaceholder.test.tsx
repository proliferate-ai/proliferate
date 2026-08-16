// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "#product/config/chat-layout";
import { TranscriptSwitchingPlaceholder } from "./TranscriptSwitchingPlaceholder";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("TranscriptSwitchingPlaceholder", () => {
  it("keeps the status region present but withholds the living mark inside the show delay", () => {
    render(<TranscriptSwitchingPlaceholder label="Switching chat" />);

    const gutter = screen.getByRole("status", { name: "Switching chat" });
    // The accessible status region mounts immediately; the treatment does not.
    expect(gutter.querySelector("[data-brand-mark]")).toBeNull();
    expect(gutter.querySelector("[data-dot-cell-loader]")).toBeNull();

    advance(motion.loading.showDelayMs);

    expect(gutter.querySelector("[data-brand-mark]")).not.toBeNull();
    // Negative control: DotCellLoader is retired from this surface entirely.
    expect(gutter.querySelector("[data-dot-cell-loader]")).toBeNull();
  });

  it("uses the same column and gutter order once the living mark mounts", () => {
    render(<TranscriptSwitchingPlaceholder />);
    advance(motion.loading.showDelayMs);

    const gutter = screen.getByRole("status", { name: "Loading chat" });
    expect(gutter.className).toContain(CHAT_SURFACE_GUTTER_CLASSNAME);
    expect(gutter.firstElementChild?.className).toContain(CHAT_COLUMN_CLASSNAME);
    // The single sanctioned reveal is the content fade-in.
    expect(gutter.firstElementChild?.className).toContain("animate-content-fade-in");
  });

  it("shows the Class A living mark alone instead of message skeletons (PRO-182); label is accessibility-only", () => {
    render(<TranscriptSwitchingPlaceholder label="Switching chat" />);
    advance(motion.loading.showDelayMs);

    const gutter = screen.getByRole("status", { name: "Switching chat" });
    expect(gutter.querySelector("[data-brand-mark]")).not.toBeNull();
    // No visible label beside the mark (founder ruling, R16): the label is
    // the aria-label on the status region, not visible text.
    expect(gutter.textContent).not.toContain("Switching chat");
  });
});
