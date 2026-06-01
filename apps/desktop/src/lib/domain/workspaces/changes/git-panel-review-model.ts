import {
  GIT_DIFF_FETCH_CONCURRENCY_LIMIT,
  resolveDiffDisplayPolicy,
} from "@/lib/domain/workspaces/changes/diff-display-policy";
import type {
  GitPanelMode,
  GitPanelReviewScope,
  GitPanelSection,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import type { GitReviewFileEntry } from "@/lib/domain/workspaces/changes/git-review-entries";

export interface GitPanelSectionStats {
  additions: number;
  deletions: number;
}

export interface LastTurnUndoStateInput {
  mode: GitPanelMode;
  lastTurnUndoCompleted: boolean;
  blockedReason: string | null;
  activeWorkspaceId: string | null;
  patchCount: number;
}

export function summarizeGitPanelSectionStats(
  sections: readonly GitPanelSection[],
): GitPanelSectionStats {
  return sections.reduce(
    (stats, section) => {
      for (const file of section.files) {
        stats.additions += file.currentDiff?.additions ?? 0;
        stats.deletions += file.currentDiff?.deletions ?? 0;
      }
      return stats;
    },
    { additions: 0, deletions: 0 },
  );
}

export function buildGitPanelDiffFetchScopeKey(args: {
  activeWorkspaceId: string | null;
  baseRef: string | null;
  mode: GitPanelMode;
  reviewEntries: readonly GitReviewFileEntry[];
}): string {
  return [
    args.activeWorkspaceId ?? "",
    args.baseRef ?? "",
    args.mode,
    args.reviewEntries.map((entry) => entry.key).join("\n"),
  ].join("\u001f");
}

export function resolvePermittedGitPanelDiffFetchKeys(args: {
  reviewEntries: readonly GitReviewFileEntry[];
  visibleSectionScopes: ReadonlySet<GitPanelReviewScope>;
  effectiveCollapsedFiles: ReadonlySet<string>;
  settledDiffFetchKeys: ReadonlySet<string>;
}): ReadonlySet<string> {
  const permitted = new Set(args.settledDiffFetchKeys);
  let activeFetchCount = 0;
  for (const entry of args.reviewEntries) {
    if (activeFetchCount >= GIT_DIFF_FETCH_CONCURRENCY_LIMIT) {
      break;
    }
    if (
      permitted.has(entry.key)
      || !args.visibleSectionScopes.has(entry.sectionScope)
    ) {
      continue;
    }
    const currentDiff = entry.file.currentDiff;
    if (!currentDiff || args.effectiveCollapsedFiles.has(entry.key)) {
      continue;
    }
    const displayPolicy = resolveDiffDisplayPolicy({
      path: currentDiff.path,
      additions: currentDiff.additions,
      deletions: currentDiff.deletions,
    });
    if (!displayPolicy.canFetchInline) {
      continue;
    }
    permitted.add(entry.key);
    activeFetchCount += 1;
  }
  return permitted;
}

export function resolveLastTurnUndoDisabledReason(
  input: LastTurnUndoStateInput,
): string | null {
  if (input.mode !== "last_turn") {
    return null;
  }
  if (input.lastTurnUndoCompleted) {
    return "Undo has already been applied for this turn.";
  }
  return input.blockedReason
    ?? (!input.activeWorkspaceId
      ? "Undo is unavailable until a workspace is selected."
      : null)
    ?? (input.patchCount === 0
      ? "Undo is unavailable because this turn has no complete file patches."
      : null);
}

export function countUniqueReviewPatchPaths(
  entries: readonly { path: string }[],
): number {
  return new Set(entries.map((entry) => entry.path)).size;
}

export function toggleReviewSetValue<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}
