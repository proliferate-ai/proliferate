import { getGitFileStatusPresentation } from "@/lib/domain/workspaces/changes/git-file-status-presentation";
import type { GitPanelFile } from "@/lib/domain/workspaces/changes/git-panel-diff";

export function GitReviewStatusBadge({ status }: { status: GitPanelFile["status"] }) {
  const meta = getGitFileStatusPresentation(status);
  return (
    <span
      className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-medium leading-none ${meta.className}`}
      title={meta.title}
      aria-label={meta.title}
    >
      {meta.label}
    </span>
  );
}
