/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranchRef } from "@anyharness/sdk";
import { GitReviewTargetSelector } from "./GitReviewTargetSelector";

// Radix Popover touches DOM APIs jsdom does not implement.
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

afterEach(() => {
  cleanup();
});

function branch(name: string, isDefault = false): GitBranchRef {
  return {
    name,
    isDefault,
    isHead: false,
    isRemote: name.includes("/"),
    upstream: null,
  } satisfies GitBranchRef;
}

function openSelector(branchRefs: readonly GitBranchRef[]) {
  const onSelect = vi.fn();
  render(
    <GitReviewTargetSelector
      mode="branch"
      baseRef="origin/main"
      branchRefs={branchRefs}
      isRuntimeReady
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /origin\/main/ }));
  const search = screen.getByLabelText("Search branches");
  const frame = search.closest("div.flex.flex-col") as HTMLElement;
  return { onSelect, search, frame };
}

describe("GitReviewTargetSelector picker", () => {
  it("draws the shared picker skeleton with this picker's shorter cap", () => {
    const { search } = openSelector([branch("origin/main", true), branch("feature/one")]);

    // The search row is the pattern's, not a hand-rolled boxed field.
    expect(search.className).toContain("bg-transparent");
    expect(document.activeElement).toBe(search);

    // `max-h-64` must survive the pattern's `max-h-80` default, which is why
    // PickerPopoverContent merges rather than concatenates its className.
    const frame = search.closest("div.flex.flex-col");
    expect(frame?.className).toContain("max-h-64");
    expect(frame?.className).not.toContain("max-h-80");
    expect(frame?.querySelector(".overflow-y-auto")).not.toBeNull();
    // PickerEmptyRow is unreachable here: the active ref is prepended whenever
    // the filter drops it, so the list is never empty. Left wired for the day
    // that changes rather than deleted.
  });

  it("filters branches, caps the list at 40, and keeps the row chrome", () => {
    const { onSelect, search, frame } = openSelector([
      branch("origin/main", true),
      ...Array.from({ length: 60 }, (_, index) => branch(`origin/feature-${index}`)),
    ]);

    // 40 matches plus nothing extra: the active ref is already in the slice.
    const list = within(frame);
    expect(list.getAllByText(/^origin\//)).toHaveLength(40);
    expect(list.getByText("default")).toBeTruthy();

    fireEvent.change(search, { target: { value: "feature-7" } });
    expect(list.getByText("origin/feature-7")).toBeTruthy();
    expect(list.queryByText("origin/feature-12")).toBeNull();
    // The unmatched active ref is prepended so the current target stays visible.
    expect(list.getByText("origin/main")).toBeTruthy();

    fireEvent.click(list.getByText("origin/feature-7"));
    expect(onSelect).toHaveBeenCalledWith("origin/feature-7");
  });

  // Carried over from #1796, which added this guard on the hand-rolled field
  // the picker migration replaced. Kept as its own case so the autofocus
  // contract survives independently of the skeleton test's other claims.
  it("focuses branch search when the picker opens", async () => {
    const { search } = openSelector([branch("origin/main", true)]);

    await waitFor(() => expect(document.activeElement).toBe(search));
  });
});
