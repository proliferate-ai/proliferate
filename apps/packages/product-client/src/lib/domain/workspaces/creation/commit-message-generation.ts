import type { GitChangedFile, GitDiffScope } from "@anyharness/sdk";

/** Mirrors the server's COMMIT_MESSAGE_MAX_DIFF_CHARS — patches past the
 * budget are dropped with a trailing marker so the model knows. */
export const COMMIT_MESSAGE_DIFF_CHAR_BUDGET = 24_000;

export interface CommitDiffTarget {
  path: string;
  scope: Extract<GitDiffScope, "staged" | "working_tree">;
}

/** Which per-file diffs describe the pending commit: staged content only, or
 * the whole working tree when unstaged changes ride along. */
export function commitDiffTargets(input: {
  fileGroups: {
    staged: GitChangedFile[];
    partial: GitChangedFile[];
    unstaged: GitChangedFile[];
  };
  includeUnstaged: boolean;
}): CommitDiffTarget[] {
  if (input.includeUnstaged) {
    const seen = new Set<string>();
    const targets: CommitDiffTarget[] = [];
    for (const file of [
      ...input.fileGroups.staged,
      ...input.fileGroups.partial,
      ...input.fileGroups.unstaged,
    ]) {
      if (seen.has(file.path)) {
        continue;
      }
      seen.add(file.path);
      targets.push({ path: file.path, scope: "working_tree" });
    }
    return targets;
  }
  return [...input.fileGroups.staged, ...input.fileGroups.partial]
    .map((file) => ({ path: file.path, scope: "staged" as const }));
}

/** Concatenate per-file patches into one prompt-sized diff. */
export function assembleCommitDiffText(
  patches: Array<{ path: string; patch: string | null; binary: boolean }>,
  budget: number = COMMIT_MESSAGE_DIFF_CHAR_BUDGET,
): string {
  const parts: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const entry of patches) {
    const text = entry.binary
      ? `Binary file changed: ${entry.path}\n`
      : entry.patch?.trim();
    if (!text) {
      continue;
    }
    if (used + text.length > budget) {
      dropped += 1;
      continue;
    }
    parts.push(text);
    used += text.length;
  }
  if (dropped > 0) {
    parts.push(`[${dropped} more changed file${dropped === 1 ? "" : "s"} omitted]`);
  }
  return parts.join("\n");
}
