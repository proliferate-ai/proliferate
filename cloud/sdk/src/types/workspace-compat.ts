// Hand-pinned compatibility shapes for the deleted cloud workspace wire
// contract. Split out of generated.ts so the generated file stays generated.
import type { CloudWorkspaceBackingKind, CloudWorkspaceCloudAccessSummary } from "./generated.js";

// TODO(cull-trail): the server's cloud workspace surface is deleted, so the
// ``WorkspaceMaterializationSummary`` wire schema no longer exists. The shape
// is pinned by hand (from the last generated contract) because the shared
// workspace domain model (logical workspaces, inventory, reconciliation) still
// compiles against it; the data sources are gone, so these only describe
// cached/derived values that are now always absent at runtime.
export interface CloudWorkspaceMaterializationSummary {
  id: string;
  targetKind: "managed_cloud" | "local_desktop";
  desktopInstallId: string | null;
  anyharnessWorkspaceId: string | null;
  worktreePath: string | null;
  state: "pending" | "hydrating" | "hydrated" | "missing" | "inconsistent" | "failed";
  generation: number;
  expectedHeadSha: string | null;
  observedHeadSha: string | null;
  observedBranch: string | null;
  failureCode: string | null;
  lastReportedAt: string | null;
}

// TODO(cull-trail): ``RepoRef`` left the wire contract with the cloud workspace
// surface; pinned by hand because the workspace domain model still names repos
// with this shape.
export interface RepoRef {
  provider: string;
  owner: string;
  name: string;
  branch: string;
  baseBranch: string;
}

// TODO(cull-trail): the server's cloud workspace surface is deleted, so the
// ``WorkspaceSummary`` wire schema this type derived from no longer exists.
// The wire base is pinned by hand from the last generated contract (with the
// prior ``Required<>`` normalization applied): the shared workspace domain
// model — logical workspaces, inventory, recent-work items, reconciliation —
// still compiles against this shape, while every data source that produced
// values of it is gone.
export interface CloudWorkspaceSummaryWireBase {
  id: string;
  targetId: string | null;
  workspaceKind: CloudWorkspaceBackingKind;
  repoEnvironmentId: string | null;
  displayName: string;
  repo: RepoRef | null;
  productLifecycle: "active" | "archived";
  selectedMaterializationId: string | null;
  primaryMaterialization: CloudWorkspaceMaterializationSummary | null;
  materializations: CloudWorkspaceMaterializationSummary[];
  cloudAccess: CloudWorkspaceCloudAccessSummary;
  statusDetail: string | null;
  lastError: string | null;
  templateVersion: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  readyAt: string | null;
  postReadyPhase: "idle";
  postReadyFilesTotal: number;
  postReadyFilesApplied: number;
  postReadyStartedAt: string | null;
  postReadyCompletedAt: string | null;
  lastActivityAt: string | null;
  allowedAgentKinds: string[];
  readyAgentKinds: string[];
  anyharnessWorkspaceId: string | null;
}

