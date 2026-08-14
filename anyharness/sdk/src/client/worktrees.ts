import type {
  PruneOrphanWorktreeRequest,
  WorktreeInventoryResponse,
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
}
