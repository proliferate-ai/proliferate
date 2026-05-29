import type { ProductWorkspaceKind, ProductWorkspaceStatus } from "./model";

export function workspaceKindLabel(kind: ProductWorkspaceKind): string {
  return kind === "shared" ? "Team" : "Personal";
}

export function workspaceStatusLabel(status: ProductWorkspaceStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "starting":
      return "Starting";
    case "paused":
      return "Paused";
    case "failed":
      return "Failed";
  }
}

export function workspaceSubtitle(repoLabel?: string | null, branchLabel?: string | null): string {
  return [repoLabel, branchLabel].filter(Boolean).join(" · ");
}
