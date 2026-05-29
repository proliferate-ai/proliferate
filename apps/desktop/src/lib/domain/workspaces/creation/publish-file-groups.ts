import type { GitChangedFile } from "@anyharness/sdk";
import type { PublishFileGroups } from "@/lib/domain/workspaces/creation/publish-workflow-model";

const PARTIAL_WARNING =
  "Including unstaged changes will also include all unstaged hunks in partially staged files.";
const PARTIAL_STAGED_ONLY_WARNING =
  "Partially staged files can show combined file totals; with Include unstaged off, only staged hunks are committed.";

export function partialFileWarning(hasPartialFiles: boolean, includeUnstaged: boolean): string | null {
  if (!hasPartialFiles) return null;
  return includeUnstaged ? PARTIAL_WARNING : PARTIAL_STAGED_ONLY_WARNING;
}

export function groupPublishFiles(files: GitChangedFile[]): PublishFileGroups {
  const publishable = files.filter((file) =>
    file.path.length > 0 && !file.path.startsWith(".claude/worktrees/")
  );
  return {
    staged: publishable.filter((file) => file.includedState === "included"),
    partial: publishable.filter((file) => file.includedState === "partial"),
    unstaged: publishable.filter((file) => file.includedState === "excluded"),
  };
}
