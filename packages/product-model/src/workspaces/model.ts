export type ProductWorkspaceKind = "shared" | "personal";

export type ProductWorkspaceStatus = "ready" | "starting" | "paused" | "failed";

export interface ProductWorkspaceSummary {
  id: string;
  name: string;
  repoLabel?: string | null;
  branchLabel?: string | null;
  kind: ProductWorkspaceKind;
  status: ProductWorkspaceStatus;
}
