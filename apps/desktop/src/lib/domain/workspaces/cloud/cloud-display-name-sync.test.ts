import { describe, expect, it } from "vitest";
import {
  CLOUD_DISPLAY_NAME_SYNC_RETRY_INTERVAL_MS,
  markCloudDisplayNameSyncCompleted,
  resolveCloudDisplayNameSyncAttempt,
  shouldBackfillCloudDisplayNameFromRuntime,
  type CloudDisplayNameSyncState,
} from "./cloud-display-name-sync";

describe("cloud display name sync", () => {
  it("retries after a failed cloud update leaves the sync incomplete", () => {
    const first = resolveCloudDisplayNameSyncAttempt({
      state: null,
      syncKey: "cloud-1:runtime-workspace-1",
      nowMs: 1_000,
      inFlight: false,
    });

    expect(first.shouldAttempt).toBe(true);

    const retry = resolveCloudDisplayNameSyncAttempt({
      state: first.state,
      syncKey: "cloud-1:runtime-workspace-1",
      nowMs: 1_000 + CLOUD_DISPLAY_NAME_SYNC_RETRY_INTERVAL_MS,
      inFlight: false,
    });

    expect(retry.shouldAttempt).toBe(true);
  });

  it("does not mark a sync complete until the caller records success", () => {
    const state: CloudDisplayNameSyncState = {
      key: "cloud-1:runtime-workspace-1",
      completed: false,
      lastAttemptAtMs: 1_000,
    };

    const beforeCompletion = resolveCloudDisplayNameSyncAttempt({
      state,
      syncKey: "cloud-1:runtime-workspace-1",
      nowMs: 1_000 + CLOUD_DISPLAY_NAME_SYNC_RETRY_INTERVAL_MS,
      inFlight: false,
    });
    const completed = markCloudDisplayNameSyncCompleted(
      beforeCompletion.state,
      "cloud-1:runtime-workspace-1",
    );
    const afterCompletion = resolveCloudDisplayNameSyncAttempt({
      state: completed,
      syncKey: "cloud-1:runtime-workspace-1",
      nowMs: 1_000 + (CLOUD_DISPLAY_NAME_SYNC_RETRY_INTERVAL_MS * 2),
      inFlight: false,
    });

    expect(beforeCompletion.shouldAttempt).toBe(true);
    expect(afterCompletion.shouldAttempt).toBe(false);
  });

  it("resets retry state when the selected cloud runtime workspace changes", () => {
    const first = resolveCloudDisplayNameSyncAttempt({
      state: {
        key: "cloud-1:runtime-workspace-1",
        completed: true,
        lastAttemptAtMs: 1_000,
      },
      syncKey: "cloud-1:runtime-workspace-2",
      nowMs: 1_500,
      inFlight: false,
    });

    expect(first.state).toEqual({
      key: "cloud-1:runtime-workspace-2",
      completed: false,
      lastAttemptAtMs: 1_500,
    });
    expect(first.shouldAttempt).toBe(true);
  });

  it("does not backfill when a user reset suppressed runtime propagation", () => {
    const decision = shouldBackfillCloudDisplayNameFromRuntime({
      runtimeDisplayName: "Old runtime name",
      backfillSuppressed: true,
    });

    expect(decision).toEqual({
      shouldBackfill: false,
      displayName: null,
    });
  });

  it("backfills after an unrelated cloud row update", () => {
    const decision = shouldBackfillCloudDisplayNameFromRuntime({
      runtimeDisplayName: "Generated first-session name",
      backfillSuppressed: false,
    });

    expect(decision).toEqual({
      shouldBackfill: true,
      displayName: "Generated first-session name",
    });
  });

  it("keeps a user-cleared blank cloud display name after reload/remount", () => {
    const decision = shouldBackfillCloudDisplayNameFromRuntime({
      runtimeDisplayName: "Generated first-session name",
      backfillSuppressed: true,
    });

    expect(decision).toEqual({
      shouldBackfill: false,
      displayName: null,
    });
  });

  it("backfills a trimmed runtime display name when propagation is not suppressed", () => {
    const decision = shouldBackfillCloudDisplayNameFromRuntime({
      runtimeDisplayName: "  New runtime name  ",
      backfillSuppressed: false,
    });

    expect(decision).toEqual({
      shouldBackfill: true,
      displayName: "New runtime name",
    });
  });

  it("does not backfill a blank runtime display name", () => {
    const decision = shouldBackfillCloudDisplayNameFromRuntime({
      runtimeDisplayName: "   ",
      backfillSuppressed: false,
    });

    expect(decision).toEqual({
      shouldBackfill: false,
      displayName: null,
    });
  });
});
