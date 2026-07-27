// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingIndicator } from "#product/components/workspace/chat/transcript/StreamingIndicator";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-20T06:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("StreamingIndicator", () => {
  it("renders the Thinking gleam without an elapsed-seconds suffix", () => {
    render(<StreamingIndicator startedAt="2026-07-20T05:59:59.000Z" />);

    // "Thinking" renders twice (base text + aria-hidden band glyph copy).
    expect(screen.getAllByText("Thinking").length).toBeGreaterThan(0);

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByText(/\d+s/)).toBeNull();
  });
});
