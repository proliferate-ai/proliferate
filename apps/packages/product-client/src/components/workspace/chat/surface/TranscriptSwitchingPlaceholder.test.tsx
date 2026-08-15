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
  it("keeps the status region present but withholds the loader inside the show delay", () => {
    render(<TranscriptSwitchingPlaceholder label="Switching chat" />);

    const gutter = screen.getByRole("status", { name: "Switching chat" });
    // The accessible status region mounts immediately; the treatment does not.
    expect(gutter.querySelector("[data-dot-cell-loader]")).toBeNull();

    advance(motion.loading.showDelayMs);

    expect(gutter.querySelector("[data-dot-cell-loader]")).not.toBeNull();
  });

  it("uses the same column and gutter order once the loader mounts", () => {
    render(<TranscriptSwitchingPlaceholder />);
    advance(motion.loading.showDelayMs);

    const gutter = screen.getByRole("status", { name: "Loading chat" });
    expect(gutter.className).toContain(CHAT_SURFACE_GUTTER_CLASSNAME);
    expect(gutter.firstElementChild?.className).toContain(CHAT_COLUMN_CLASSNAME);
    // The single sanctioned reveal is the content fade-in.
    expect(gutter.firstElementChild?.className).toContain("animate-content-fade-in");
  });

  it("shows a clean loader with its label instead of message skeletons (PRO-182)", () => {
    render(<TranscriptSwitchingPlaceholder label="Switching chat" />);
    advance(motion.loading.showDelayMs);

    const gutter = screen.getByRole("status", { name: "Switching chat" });
    expect(gutter.querySelector("[data-dot-cell-loader]")).not.toBeNull();
    expect(gutter.textContent).toContain("Switching chat");
  });
});
