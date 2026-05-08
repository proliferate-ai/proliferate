import { useGitDiffQuery } from "@anyharness/sdk-react";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import type { FileDiffTarget } from "@/lib/domain/workspaces/viewer/file-diff-options";
import { CenterMessage } from "./CenterMessage";

export function FileDiffPane({
  workspaceId,
  target,
  layout,
}: {
  workspaceId: string | null;
  target: FileDiffTarget;
  layout: "unified" | "split";
}) {
  const diffQuery = useGitDiffQuery({
    workspaceId,
    path: target.path,
    scope: target.scope,
    baseRef: target.scope === "branch" ? target.baseRef : null,
    oldPath: target.scope === "branch" ? target.oldPath : null,
  });

  if (diffQuery.isLoading) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading diff</p>
    );
  }

  if (diffQuery.data?.patch) {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <DiffViewer patch={diffQuery.data.patch} layout={layout} />
      </div>
    );
  }

  if (diffQuery.data?.binary) {
    return (
      <CenterMessage message="Binary file changed" />
    );
  }

  return (
    <CenterMessage message="No diff available" />
  );
}
