import type {
  AnyHarnessRequestOptions,
  PruneOrphanWorktreeRequest,
} from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function getWorktreeInventory(
  connection: AnyHarnessClientConnection,
  request?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).worktrees.inventory(request);
}

export function pruneOrphanWorktree(
  connection: AnyHarnessClientConnection,
  request: PruneOrphanWorktreeRequest,
) {
  return getAnyHarnessClient(connection).worktrees.pruneOrphan(request);
}
