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
  it("shows and advances elapsed seconds after the first full second", () => {
    render(<StreamingIndicator startedAt="2026-07-20T05:59:59.000Z" />);

    expect(screen.getByText(/1s/)).toBeTruthy();

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText(/3s/)).toBeTruthy();
  });
});
