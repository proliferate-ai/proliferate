// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { TranscriptState, TurnRecord } from "@anyharness/sdk";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { TurnDiffFileCard } from "#product/components/workspace/chat/transcript/TurnDiffFileCard";
import { TurnDiffPanel } from "#product/components/workspace/chat/transcript/TurnDiffPanel";
import { GitPanelHeader } from "#product/components/workspace/git/GitPanelHeader";
import { GitReviewFileRow } from "#product/components/workspace/git/GitReviewFileRow";
import type { GitPanelReviewFile } from "#product/lib/domain/workspaces/changes/git-panel-diff";

const webTestHost = { desktop: null } as ProductHost;
const RECORDED_PATCH = [
  "@@ -1 +1 @@",
  "-before first",
  "+recorded first",
  "@@ -20 +20 @@",
  "-before second",
  "+recorded second",
].join("\n");
const STALE_PATCH = "@@ -1 +1 @@\n-stale before\n+stale cached";

const turnCurrentDiffs = vi.hoisted(() => ({
  state: null as unknown,
}));
const currentFilePatch = vi.hoisted(() => ({
  calls: [] as unknown[],
}));
const gitDiffQuery = vi.hoisted(() => ({
  state: {
    data: {
      additions: 99,
      deletions: 88,
      patch: "@@ -1 +1 @@\n-stale before\n+stale cached",
      binary: true,
      truncated: true,
    } as unknown,
    error: new Error("stale query error"),
    isError: true,
    isLoading: false,
  },
}));
const readWorkspaceFile = vi.hoisted(() => vi.fn());

vi.mock("#product/hooks/chat/cache/use-turn-current-file-diffs", () => ({
  useTurnCurrentFileDiffs: () => turnCurrentDiffs.state,
  useTurnCurrentFilePatch: (input: {
    file: GitPanelReviewFile;
    workspaceId: string | null;
    baseRef: string | null;
    enabled: boolean;
  }) => {
    currentFilePatch.calls.push(input);
    return {
      currentDiff: input.file.currentDiff,
      metadataPolicy: null,
      diffQuery: gitDiffQuery.state,
      diffData: input.file.currentDiff ? gitDiffQuery.state.data : null,
      diffErrorMessage: "stale query error",
      additions: 99,
      deletions: 88,
      patch: STALE_PATCH,
      patchPolicy: { canFetchInline: true, canRenderInline: true },
    };
  },
}));

vi.mock("@anyharness/sdk-react", () => ({
  useGitDiffQuery: () => gitDiffQuery.state,
  useRevertGitPatchesMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStagePatchMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnstagePatchMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReadWorkspaceFileMutation: () => ({ mutateAsync: readWorkspaceFile, isPending: false }),
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  currentFilePatch.calls = [];
  readWorkspaceFile.mockReset();
});

afterEach(cleanup);

describe("recorded Last turn diff continuity", () => {
  it("renders recorded transcript evidence and truthful stats instead of stale live data", () => {
    const recorded = reviewFile("recorded.ts", {
      recordedAdditions: 5,
      recordedDeletions: 2,
      recordedPatch: RECORDED_PATCH,
    });
    const metadataOnly = reviewFile("metadata.ts");
    turnCurrentDiffs.state = currentDiffState([recorded, metadataOnly]);
    const turn = completedTurn();
    const { container } = renderProduct(
      <TurnDiffPanel
        turn={turn}
        transcript={{} as TranscriptState}
        workspaceId="workspace-1"
        onOpenFile={() => {}}
      />,
    );

    expect(container.querySelectorAll('[aria-label="5"].diff-stat-rolling-number')).toHaveLength(2);
    expect(container.querySelectorAll('[aria-label="2"].diff-stat-rolling-number')).toHaveLength(2);
    expect(container.querySelector('[aria-label="99"].diff-stat-rolling-number')).toBeNull();
    expect(container.querySelector('[aria-label="88"].diff-stat-rolling-number')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for recorded.ts" }));
    expect(container.textContent).toContain("recorded first");
    expect(container.textContent).toContain("recorded second");
    expect(container.textContent).not.toContain("stale cached");
    expect(screen.queryByRole("button", { name: /^Expand / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert hunk" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stage hunk" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle diff for metadata.ts" }));
    expect(screen.getByText("No current diff")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open file" })).toBeTruthy();
    expect(readWorkspaceFile).not.toHaveBeenCalled();
  });

  it("renders recorded sidebar evidence without cached badges, mutations, or context reads", () => {
    const file = reviewFile("recorded.ts", {
      recordedAdditions: 5,
      recordedDeletions: 2,
      recordedPatch: RECORDED_PATCH,
    });
    const onDiffFetchSettled = vi.fn();
    const { container } = renderProduct(reviewRow(file, { onDiffFetchSettled }));

    expect(container.textContent).toContain("+5-2");
    expect(container.textContent).toContain("recorded first");
    expect(container.textContent).not.toContain("stale cached");
    expect(container.textContent).not.toContain("binary");
    expect(container.textContent).not.toContain("99");
    expect(container.textContent).not.toContain("88");
    expect(screen.queryByRole("button", { name: /^Expand / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert hunk" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stage hunk" })).toBeNull();
    expect(readWorkspaceFile).not.toHaveBeenCalled();
    expect(onDiffFetchSettled).not.toHaveBeenCalled();
  });

  it("keeps the sidebar no-current-diff state when no patch was recorded", () => {
    const file = reviewFile("metadata.ts");
    const openFile = vi.fn(async () => undefined);
    const onDiffFetchSettled = vi.fn();
    const { container } = renderProduct(reviewRow(file, {
      openFile,
      onDiffFetchSettled,
    }));

    expect(screen.getByText("No current diff")).toBeTruthy();
    expect(container.textContent).not.toContain("stale cached");
    expect(container.textContent).not.toContain("binary");
    expect(container.textContent).not.toContain("99");
    expect(container.textContent).not.toContain("88");
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    expect(openFile).toHaveBeenCalledWith("metadata.ts");
    expect(onDiffFetchSettled).not.toHaveBeenCalled();
  });

  it("bounds oversized recorded patches in both Last turn surfaces", () => {
    const file = reviewFile("large.ts", {
      recordedAdditions: 5_001,
      recordedDeletions: 0,
      recordedPatch: RECORDED_PATCH,
    });
    const firstRender = renderProduct(
      <TurnDiffFileCard
        file={file}
        fileCount={2}
        turnId="turn-1"
        workspaceId="workspace-1"
        baseRef="origin/main"
        cacheGeneration="generation-1"
        isRuntimeReady
        runtimeBlockedReason={null}
        metadataPending={false}
        metadataErrorMessage={null}
        fallbackAdditions={5_001}
        fallbackDeletions={0}
        isExpanded
        onToggleExpand={() => {}}
        onOpenFile={() => {}}
      />,
    );

    expect(screen.getByText("Too large to render inline")).toBeTruthy();
    expect(firstRender.container.textContent).not.toContain("recorded first");
    firstRender.unmount();

    const secondRender = renderProduct(reviewRow(file));
    expect(screen.getByText("Too large to render inline")).toBeTruthy();
    expect(secondRender.container.textContent).not.toContain("recorded first");
  });

  it("shows recorded stats in the jump-to-file entry", () => {
    const file = reviewFile("nested/recorded.ts", {
      recordedAdditions: 5,
      recordedDeletions: 2,
      recordedPatch: RECORDED_PATCH,
    });
    renderProduct(
      <GitPanelHeader
        changesFilter="last_turn"
        visibleChangedCount={1}
        additions={0}
        deletions={0}
        isRuntimeReady
        branchRefs={[]}
        baseRef="origin/main"
        layout="unified"
        wrapLongLines={false}
        allFilesCollapsed={false}
        reviewEntries={[{
          key: "file:last_turn:recorded",
          id: "git-review-recorded",
          sectionScope: "last_turn",
          file,
        }]}
        onFilterChange={() => {}}
        onBaseRefChange={() => {}}
        onToggleLayout={() => {}}
        onToggleWrap={() => {}}
        onToggleAllFiles={() => {}}
        onFocusFile={() => {}}
        onRefresh={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Jump to file" }));
    expect(screen.getByText("+5")).toBeTruthy();
    expect(screen.getByText("-2")).toBeTruthy();
  });
});

function renderProduct(ui: ReactElement) {
  return render(<ProductHostProvider host={webTestHost}>{ui}</ProductHostProvider>);
}

function currentDiffState(files: GitPanelReviewFile[]) {
  return {
    activeWorkspaceId: "workspace-1",
    baseRef: "origin/main",
    cacheGeneration: "generation-1",
    files,
    isRuntimeReady: true,
    runtimeBlockedReason: null,
    isLoading: false,
    metadataPending: false,
    errorMessage: null,
  };
}

function completedTurn(): TurnRecord {
  return {
    turnId: "turn-1",
    itemOrder: [],
    startedAt: "2026-08-19T00:00:00Z",
    completedAt: "2026-08-19T00:01:00Z",
    stopReason: "end_turn",
    fileBadges: [],
  };
}

function reviewFile(
  path: string,
  recorded: {
    recordedAdditions?: number;
    recordedDeletions?: number;
    recordedPatch?: string | null;
  } = {},
): GitPanelReviewFile {
  return {
    key: `:${path}:edit`,
    path,
    oldPath: null,
    displayPath: path,
    currentDiff: null,
    touched: {
      key: `:${path}:edit`,
      path,
      oldPath: null,
      displayPath: path,
      operation: "edit",
      topLevel: true,
      recordedAdditions: recorded.recordedAdditions ?? 0,
      recordedDeletions: recorded.recordedDeletions ?? 0,
      recordedPatch: recorded.recordedPatch ?? null,
    },
  };
}

function reviewRow(
  file: GitPanelReviewFile,
  overrides: {
    openFile?: (path: string) => Promise<void>;
    onDiffFetchSettled?: () => void;
  } = {},
) {
  return (
    <GitReviewFileRow
      id={`review-${file.path}`}
      workspaceId="workspace-1"
      sectionScope="last_turn"
      file={file}
      baseRef="origin/main"
      cacheGeneration="generation-1"
      metadataPending={false}
      layout="unified"
      wrapLongLines={false}
      collapsed={false}
      isRuntimeReady
      fetchDiff
      onToggleCollapsed={() => {}}
      onDiffFetchSettled={overrides.onDiffFetchSettled ?? (() => {})}
      openFile={overrides.openFile ?? (async () => undefined)}
      contentSearchOrderKey={0}
    />
  );
}
