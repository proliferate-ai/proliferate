/**
 * Snapshots module exports.
 */

export * from "./service";

// Re-export DB types
export type { SnapshotRow, SnapshotRepoRow, SnapshotWithReposRow } from "./db";

// DB functions needed by gateway
export { findById, findByIdWithRepos, getActiveSnapshot, markReady, markFailed } from "./db";
