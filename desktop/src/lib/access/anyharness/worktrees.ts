import type {
  AnyHarnessRequestOptions,
  PruneOrphanWorktreeRequest,
  UpdateWorktreeRetentionPolicyRequest,
} from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function getWorktreeRetentionPolicy(connection: AnyHarnessClientConnection) {
  return getAnyHarnessClient(connection).worktrees.retentionPolicy();
}

export function getWorktreeInventory(
  connection: AnyHarnessClientConnection,
  request?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).worktrees.inventory(request);
}

export function updateWorktreeRetentionPolicy(
  connection: AnyHarnessClientConnection,
  request: UpdateWorktreeRetentionPolicyRequest,
) {
  return getAnyHarnessClient(connection).worktrees.updateRetentionPolicy(request);
}

export function runWorktreeRetention(connection: AnyHarnessClientConnection) {
  return getAnyHarnessClient(connection).worktrees.runRetention();
}

export function pruneOrphanWorktree(
  connection: AnyHarnessClientConnection,
  request: PruneOrphanWorktreeRequest,
) {
  return getAnyHarnessClient(connection).worktrees.pruneOrphan(request);
}
