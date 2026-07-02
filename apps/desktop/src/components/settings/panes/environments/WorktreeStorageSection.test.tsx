// @vitest-environment jsdom

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreePolicyRow } from "./WorktreeStorageSection";

/**
 * Mirrors the useWorktreeCleanupPolicy contract just enough to exercise the
 * row: draft state is a string, apply commits the parsed draft as the new
 * current value. Limits are the real ones (min 10, max 100).
 */
function Harness({
  initial = 20,
  onApplied,
}: {
  initial?: number;
  onApplied: (value: number) => void;
}) {
  const [current, setCurrent] = useState(initial);
  const [draft, setDraft] = useState(String(initial));
  return (
    <WorktreePolicyRow
      draftValue={draft}
      currentValue={current}
      onDraftValueChange={setDraft}
      canApply
      applyDisabledReason={null}
      statusMessage={null}
      onApply={() => {
        const next = Number.parseInt(draft, 10);
        onApplied(next);
        setCurrent(next);
      }}
    />
  );
}

function countInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Ideal worktrees" });
}

function flushDebounce() {
  act(() => {
    vi.advanceTimersByTime(700);
  });
}

describe("WorktreePolicyRow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("commits a typed value on blur through the debounced apply path", () => {
    const onApplied = vi.fn();
    render(<Harness onApplied={onApplied} />);

    const input = countInput();
    expect(input.value).toBe("20");

    fireEvent.change(input, { target: { value: "42" } });
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input.value).toBe("42");

    expect(onApplied).not.toHaveBeenCalled();
    flushDebounce();
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith(42);
  });

  it("commits a typed value on Enter and strips non-digit characters", () => {
    const onApplied = vi.fn();
    render(<Harness onApplied={onApplied} />);

    const input = countInput();
    fireEvent.change(input, { target: { value: "4a2" } });
    expect(input.value).toBe("42");
    fireEvent.keyDown(input, { key: "Enter" });

    flushDebounce();
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith(42);
  });

  it("clamps typed values to the min/max range on commit", () => {
    const onApplied = vi.fn();
    render(<Harness onApplied={onApplied} />);

    const input = countInput();
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(input.value).toBe("10");
    flushDebounce();
    expect(onApplied).toHaveBeenLastCalledWith(10);

    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    expect(input.value).toBe("100");
    flushDebounce();
    expect(onApplied).toHaveBeenLastCalledWith(100);
    expect(onApplied).toHaveBeenCalledTimes(2);
  });

  it("reverts on Escape without committing", () => {
    const onApplied = vi.fn();
    render(<Harness onApplied={onApplied} />);

    const input = countInput();
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("20");

    fireEvent.blur(input);
    flushDebounce();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("reverts an emptied input to the last committed value on blur", () => {
    const onApplied = vi.fn();
    render(<Harness onApplied={onApplied} />);

    const input = countInput();
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.blur(input);
    expect(input.value).toBe("20");

    flushDebounce();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("keeps the stepper working and batches clicks into one apply", () => {
    const onApplied = vi.fn();
    render(<Harness onApplied={onApplied} />);

    const more = screen.getByRole("button", { name: "More ideal worktrees" });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(countInput().value).toBe("22");

    flushDebounce();
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith(22);

    fireEvent.click(screen.getByRole("button", { name: "Fewer ideal worktrees" }));
    expect(countInput().value).toBe("21");
    flushDebounce();
    expect(onApplied).toHaveBeenLastCalledWith(21);
  });
});
