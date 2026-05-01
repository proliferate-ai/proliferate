import type {
  PruneOrphanWorktreeRequest,
  RunWorktreeRetentionResponse,
  UpdateWorktreeRetentionPolicyRequest,
  WorktreeInventoryResponse,
  WorktreeRetentionPolicy,
} from "../types/worktrees.js";
import { withTimingCategory, type AnyHarnessRequestOptions, type AnyHarnessTransport } from "./core.js";

export class WorktreesClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async inventory(options?: AnyHarnessRequestOptions): Promise<WorktreeInventoryResponse> {
    return this.transport.get<WorktreeInventoryResponse>(
      "/v1/worktrees/inventory",
      withTimingCategory(options, "worktree.inventory"),
    );
  }

  async pruneOrphan(
    input: PruneOrphanWorktreeRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorktreeInventoryResponse> {
    return this.transport.post<WorktreeInventoryResponse>(
      "/v1/worktrees/orphans/prune",
      input,
      withTimingCategory(options, "worktree.orphan.prune"),
    );
  }

  async retentionPolicy(options?: AnyHarnessRequestOptions): Promise<WorktreeRetentionPolicy> {
    return this.transport.get<WorktreeRetentionPolicy>(
      "/v1/worktrees/retention-policy",
      withTimingCategory(options, "worktree.retention_policy.get"),
    );
  }

  async updateRetentionPolicy(
    input: UpdateWorktreeRetentionPolicyRequest,
    options?: AnyHarnessRequestOptions,
  ): Promise<WorktreeRetentionPolicy> {
    return this.transport.put<WorktreeRetentionPolicy>(
      "/v1/worktrees/retention-policy",
      input,
      withTimingCategory(options, "worktree.retention_policy.update"),
    );
  }

  async runRetention(options?: AnyHarnessRequestOptions): Promise<RunWorktreeRetentionResponse> {
    return this.transport.post<RunWorktreeRetentionResponse>(
      "/v1/worktrees/retention/run",
      {},
      withTimingCategory(options, "worktree.retention.run"),
    );
  }
}
