import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup as renderReactToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import {
  PLAYGROUND_END_TURN_DIFF_TRANSCRIPT,
  PLAYGROUND_PATCH_README,
} from "@/lib/domain/chat/__fixtures__/playground/git-diff-fixtures";
import { toolCallItem } from "@/lib/domain/chat/__fixtures__/playground/tool-call-item-fixture";
import { TurnDiffPanel } from "./TurnDiffPanel";

const webTestHost = { desktop: null } as ProductHost;

function renderToStaticMarkup(ui: ReactElement) {
  return renderReactToStaticMarkup(
    <ProductHostProvider host={webTestHost}>{ui}</ProductHostProvider>,
  );
}

const turnCurrentDiffs = vi.hoisted(() => ({
  state: null as unknown,
}));
const gitDiffQuery = vi.hoisted(() => ({
  calls: [] as unknown[],
  state: {
    data: null as unknown,
    error: null as unknown,
    isError: false,
    isLoading: false,
  },
}));

vi.mock("@/hooks/chat/cache/use-turn-current-file-diffs", () => ({
  useTurnCurrentFileDiffs: () => turnCurrentDiffs.state,
  useTurnCurrentFilePatch: (input: {
    file: {
      path: string;
      oldPath: string | null;
      currentDiff: {
        additions: number;
        deletions: number;
      } | null;
    };
    workspaceId: string | null;
    baseRef: string | null;
    enabled: boolean;
  }) => {
    const queryEnabled = input.enabled && Boolean(input.file.currentDiff);
    gitDiffQuery.calls.push({
      workspaceId: input.workspaceId,
      path: input.file.path,
      scope: "base_worktree",
      baseRef: input.baseRef,
      oldPath: input.file.oldPath,
      enabled: queryEnabled,
    });
    const data = gitDiffQuery.state.data as {
      additions?: number;
      deletions?: number;
      patch?: string | null;
      binary?: boolean;
      truncated?: boolean;
    } | null;
    const metadataPolicy = input.file.currentDiff
      ? { canFetchInline: true, canRenderInline: true }
      : null;
    return {
      currentDiff: input.file.currentDiff,
      metadataPolicy,
      diffQuery: gitDiffQuery.state,
      diffErrorMessage: gitDiffQuery.state.isError ? "Failed to load diff" : null,
      additions: data?.additions ?? input.file.currentDiff?.additions ?? 0,
      deletions: data?.deletions ?? input.file.currentDiff?.deletions ?? 0,
      patch: data?.patch ?? null,
      patchPolicy: data?.patch ? { canFetchInline: true, canRenderInline: true } : metadataPolicy,
    };
  },
}));

vi.mock("@anyharness/sdk-react", () => ({
  useGitDiffQuery: () => gitDiffQuery.state,
  useReadWorkspaceFileMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("TurnDiffPanel", () => {
  beforeEach(() => {
    turnCurrentDiffs.state = currentDiffState([
      currentFile("README.md", 2, 1),
      currentFile("apps/desktop/src/components/workspace/git/GitPanel.tsx", 2, 1),
    ]);
    gitDiffQuery.calls = [];
    gitDiffQuery.state = {
      data: {
        patch: PLAYGROUND_PATCH_README,
        additions: 2,
        deletions: 1,
        binary: false,
        truncated: false,
      },
      error: null,
      isError: false,
      isLoading: false,
    };
  });

  it("renders multi-file end-of-turn diffs with a clean aggregate header", () => {
    const turn = PLAYGROUND_END_TURN_DIFF_TRANSCRIPT.turnsById["turn-end-diff"];
    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn,
        transcript: PLAYGROUND_END_TURN_DIFF_TRANSCRIPT,
        workspaceId: "workspace-1",
        onOpenFile: () => {},
      }),
    );

    expect(html).toContain("Edited 2 files");
    expect(html).toContain("bg-[var(--color-diff-panel-surface)]");
    expect(html).toContain("data-chat-diff-wrap-context-trigger=\"turn-header\"");
    expect(html).toContain("bg-[var(--color-diff-chat-turn-header-surface)]");
    expect(html).toContain("hover:bg-[var(--color-diff-chat-turn-header-hover-surface)]");
    expect(html).toContain("bg-[var(--color-diff-chat-turn-icon-surface)]");
    expect(html).toContain("border border-border");
    expect(html).toContain(">+2</span>");
    expect(html).toContain(">-1</span>");
    expect(html).toContain("data-diff-surface=\"chat\"");
    expect(html).toContain("thread-diff-virtualized");
    expect(html).toContain("data-app-action-review-file-expanded=\"false\"");
    expect(html).not.toContain("data-gutter=\"\"");
    expect(html).not.toContain("data-content=\"\"");
    expect(html).toContain("README.md");
    expect(html).toContain("GitPanel.tsx");
    expect(gitDiffQuery.calls[0]).toMatchObject({
      workspaceId: "workspace-1",
      path: "README.md",
      scope: "base_worktree",
      baseRef: "origin/main",
      enabled: false,
    });
  });

  it("renders visible aggregate review and undo actions while file rows keep their action", () => {
    const turn = PLAYGROUND_END_TURN_DIFF_TRANSCRIPT.turnsById["turn-end-diff"];
    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn,
        transcript: PLAYGROUND_END_TURN_DIFF_TRANSCRIPT,
        workspaceId: "workspace-1",
        onOpenFile: () => {},
        onOpenReviewPane: () => {},
        onUndoTurnChanges: () => {},
      }),
    );

    expect(html).not.toContain("Open changes review");
    expect(html).toContain(">Review</button>");
    expect(html).toContain(">Undo</button>");
    expect(html).toContain("Review changes");
    expect(html).toContain("Show file in review");
    expect(html).toContain("group-hover/turn-diff-header:opacity-100");
    expect(html).not.toContain("hover:[&amp;_.turn-diff-default-subtitle]:hidden");
    expect(html).toContain("data-app-action-review-file-toggle");
  });

  it("uses file-specific single-file end-turn copy without repeating row stats", () => {
    turnCurrentDiffs.state = currentDiffState([
      currentFile("README.md", 2, 1),
    ]);
    const transcript = structuredClone(PLAYGROUND_END_TURN_DIFF_TRANSCRIPT);
    transcript.turnsById["turn-end-diff"].itemOrder = [
      "assistant-end-diff",
      "tool-end-diff-readme",
    ];
    transcript.turnsById["turn-end-diff"].fileBadges = [
      { path: "README.md", additions: 2, deletions: 1 },
    ];

    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn: transcript.turnsById["turn-end-diff"],
        transcript,
        workspaceId: "workspace-1",
        onOpenFile: () => {},
        onOpenReviewPane: () => {},
      }),
    );

    expect(html).toContain("Edited README.md");
    expect(html).not.toContain("Edited 1 file");
    expect(html).toContain(">Details</span>");
    expect(html.match(/>\+2<\/span>/g)).toHaveLength(1);
    expect(html.match(/>-1<\/span>/g)).toHaveLength(1);
    expect(html).toContain("data-app-action-review-file-expanded=\"false\"");
    expect(html).not.toContain("data-gutter=\"\"");
    expect(html).not.toContain("data-content=\"\"");
  });

  it("keeps current git diff rows when transcript patches are blank", () => {
    const transcript = structuredClone(PLAYGROUND_END_TURN_DIFF_TRANSCRIPT);
    const readmeItem = transcript.itemsById["tool-end-diff-readme"] as {
      contentParts: Array<{ patch?: string }>;
    };
    const gitItem = transcript.itemsById["tool-end-diff-git"] as {
      contentParts: Array<{ patch?: string }>;
    };
    const readmePart = readmeItem.contentParts[0];
    const gitPart = gitItem.contentParts[0];
    readmePart.patch = "\n";
    gitPart.patch = "   ";

    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn: transcript.turnsById["turn-end-diff"],
        transcript,
        workspaceId: "workspace-1",
        onOpenFile: () => {},
      }),
    );

    expect(html).toContain("Edited 2 files");
    expect(html).toContain("README.md");
    expect(html).toContain("GitPanel.tsx");
  });

  it("shows only the first few file changes until expanded", () => {
    turnCurrentDiffs.state = currentDiffState(
      Array.from({ length: 5 }, (_, index) => currentFile(`src/file-${index}.ts`, 1, 1)),
    );
    const transcript = structuredClone(PLAYGROUND_END_TURN_DIFF_TRANSCRIPT);
    const itemIds = Array.from({ length: 5 }, (_, index) => `tool-end-diff-extra-${index}`);
    transcript.turnsById["turn-end-diff"].itemOrder = ["assistant-end-diff", ...itemIds];
    for (const [index, itemId] of itemIds.entries()) {
      transcript.itemsById[itemId] = toolCallItem({
        itemId,
        toolCallId: itemId,
        turnId: "turn-end-diff",
        title: `Edit file-${index}.ts`,
        nativeToolName: "Edit",
        toolKind: "edit",
        semanticKind: "file_change",
        contentParts: [{
          type: "file_change",
          operation: "edit",
          path: `/Users/pablo/proliferate/src/file-${index}.ts`,
          workspacePath: `src/file-${index}.ts`,
          basename: `file-${index}.ts`,
          additions: 1,
          deletions: 1,
          patch: PLAYGROUND_PATCH_README,
        }],
      });
    }

    const html = renderToStaticMarkup(
      createElement(TurnDiffPanel, {
        turn: transcript.turnsById["turn-end-diff"],
        transcript,
        workspaceId: "workspace-1",
        onOpenFile: () => {},
      }),
    );

    expect(html).toContain("Edited 5 files");
    expect(html).toContain("src/file-0.ts");
    expect(html).toContain("src/file-2.ts");
    expect(html).not.toContain("src/file-3.ts");
    expect(html).toContain("Show 2 more files");
  });
});

function currentDiffState(files: unknown[]) {
  return {
    activeWorkspaceId: "workspace-1",
    baseRef: "origin/main",
    files,
    isRuntimeReady: true,
    runtimeBlockedReason: null,
    isLoading: false,
    errorMessage: null,
  };
}

function currentFile(path: string, additions: number, deletions: number) {
  const currentDiff = {
    key: `:${path}:modified`,
    path,
    oldPath: null,
    displayPath: path,
    status: "modified",
    includedState: null,
    additions,
    deletions,
    binary: false,
  };
  return {
    key: currentDiff.key,
    path,
    oldPath: null,
    displayPath: path,
    currentDiff,
    touched: {
      key: currentDiff.key,
      path,
      oldPath: null,
      displayPath: path,
      operation: "edit",
      topLevel: true,
    },
  };
}
