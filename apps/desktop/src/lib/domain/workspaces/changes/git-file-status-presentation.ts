import type { GitPanelFile } from "@/lib/domain/workspaces/changes/git-panel-diff";

export interface GitFileStatusPresentation {
  label: string;
  title: string;
  className: string;
}

export function getGitFileStatusPresentation(
  status: GitPanelFile["status"],
): GitFileStatusPresentation {
  switch (status) {
    case "added":
    case "untracked":
      return {
        label: "A",
        title: "Added",
        className: "bg-git-green/10 text-git-green",
      };
    case "deleted":
      return {
        label: "D",
        title: "Deleted",
        className: "bg-git-red/10 text-git-red",
      };
    case "renamed":
      return {
        label: "R",
        title: "Renamed",
        className: "bg-sidebar-accent text-sidebar-foreground",
      };
    case "copied":
      return {
        label: "C",
        title: "Copied",
        className: "bg-sidebar-accent text-sidebar-foreground",
      };
    case "conflicted":
      return {
        label: "!",
        title: "Conflicted",
        className: "bg-destructive/10 text-destructive",
      };
    case "modified":
    default:
      return {
        label: "M",
        title: "Modified",
        className: "bg-sidebar-accent text-sidebar-muted-foreground",
      };
  }
}
