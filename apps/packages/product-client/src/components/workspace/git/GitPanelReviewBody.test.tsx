// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";

import { GitPanelReviewBody } from "#product/components/workspace/git/GitPanelReviewBody";
import type { DiffDisplayPolicySummary } from "#product/lib/domain/workspaces/changes/diff-display-policy";

const { showDelayMs, minDisplayMs } = motion.loading;

const NO_CHANGES_COPY = "Working tree clean";

const diffPolicySummary: DiffDisplayPolicySummary = {
  total: 0,
  suppressed: 0,
  suppressedPaths: [],
} as unknown as DiffDisplayPolicySummary;

function renderBody(overrides: Partial<Parameters<typeof GitPanelReviewBody>[0]> = {}) {
  return render(
    <GitPanelReviewBody
      changesFilter="working_tree_composite"
      baseRef={null}
      isLoading={false}
      errorMessage={null}
      runtimeBlockedReason={null}
      hasReviewEntries={false}
      lastTurnPatchFileCount={0}
      lastTurnUndoDisabledReason={null}
      lastTurnUndoBusy={false}
      diffPolicySummary={diffPolicySummary}
      sections={[]}
      activeWorkspaceId={null}
      layout="unified"
      wrapLongLines={false}
      collapsedFiles={new Set()}
      isRuntimeReady
      permittedDiffFetchKeys={new Set()}
      openFile={async () => undefined}
      onRefresh={() => undefined}
      onUndoLastTurn={() => undefined}
      onToggleFileCollapsed={() => undefined}
      onDiffFetchSettled={() => undefined}
      {...overrides}
    />,
  );
}

describe("GitPanelReviewBody loading vs empty split (Rung 4 / Q19)", () => {
  afterEach(cleanup);

  it("shows no 'no changes' copy while the diff query is pending", () => {
    vi.useFakeTimers();
    try {
      renderBody({ isLoading: true });

      act(() => {
        vi.advanceTimersByTime(showDelayMs - 1);
      });
      expect(screen.queryByText(NO_CHANGES_COPY)).toBeNull();

      // Class C: still nothing after the show-delay while pending.
      act(() => {
        vi.advanceTimersByTime(showDelayMs + minDisplayMs + 50);
      });
      expect(screen.queryByText(NO_CHANGES_COPY)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the no-changes state only once the query resolves with no entries", () => {
    const { rerender } = renderBody({ isLoading: true });
    expect(screen.queryByText(NO_CHANGES_COPY)).toBeNull();

    rerender(
      <GitPanelReviewBody
        changesFilter="working_tree_composite"
        baseRef={null}
        isLoading={false}
        errorMessage={null}
        runtimeBlockedReason={null}
        hasReviewEntries={false}
        lastTurnPatchFileCount={0}
        lastTurnUndoDisabledReason={null}
        lastTurnUndoBusy={false}
        diffPolicySummary={diffPolicySummary}
        sections={[]}
        activeWorkspaceId={null}
        layout="unified"
        wrapLongLines={false}
        collapsedFiles={new Set()}
        isRuntimeReady
        permittedDiffFetchKeys={new Set()}
        openFile={async () => undefined}
        onRefresh={() => undefined}
        onUndoLastTurn={() => undefined}
        onToggleFileCollapsed={() => undefined}
        onDiffFetchSettled={() => undefined}
      />,
    );

    expect(screen.getByText(NO_CHANGES_COPY)).toBeTruthy();
  });

  it("renders the error message ahead of the loading gate", () => {
    renderBody({ isLoading: true, errorMessage: "Diff fetch failed" });
    expect(screen.getByText("Diff fetch failed")).toBeTruthy();
    expect(screen.queryByText(NO_CHANGES_COPY)).toBeNull();
  });
});
