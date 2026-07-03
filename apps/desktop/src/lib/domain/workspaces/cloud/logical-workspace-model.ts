import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type {
  CloudWorkspaceSummary,
} from "@/lib/domain/workspaces/cloud/cloud-workspace-model";

export interface LogicalWorkspace {
  id: string;
  repoKey: string;
  sourceRoot: string;
  repoRoot: RepoRoot | null;
  provider: string | null;
  owner: string | null;
  repoName: string | null;
  branchKey: string;
  displayName: string;
  localWorkspace: Workspace | null;
  cloudWorkspace: CloudWorkspaceSummary | null;
  aliasIds?: string[];
  preferredMaterializationId: string | null;
  effectiveOwner: "local" | "cloud";
  lifecycle:
    | "local_active"
    | "moving_to_cloud"
    | "cloud_active"
    | "shared_cloud_active"
    | "ssh_active"
    | "moving_to_local"
    | "handoff_failed"
    | "cleanup_failed"
    | "repair_required"
    | "cloud_lost";
  updatedAt: string;
}
