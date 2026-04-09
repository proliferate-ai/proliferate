import { describe, expect, it } from "vitest";
import type { SessionLiveConfigSnapshot } from "@anyharness/sdk";
import {
  collectFailedQueuedChanges,
  collectFailedQueuedChangesMatchingMutationIds,
  getAuthoritativeConfigValue,
  reconcilePendingConfigChanges,
  resolveDisplayedSessionControlState,
  snapshotQueuedPendingConfigMutationIds,
  shouldAcceptAuthoritativeLiveConfig,
  type PendingSessionConfigChanges,
} from "./pending-config";

const LIVE_CONFIG: SessionLiveConfigSnapshot = {
  rawConfigOptions: [
    {
      id: "mode",
      name: "Mode",
      type: "select",
      currentValue: "default",
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan" },
      ],
    },
    {
      id: "effort",
      name: "Effort",
      type: "select",
      currentValue: "high",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    },
    {
      id: "fast_mode",
      name: "Fast mode",
      type: "select",
      currentValue: "off",
      options: [
        { value: "off", name: "Off" },
        { value: "on", name: "On" },
      ],
    },
  ],
  normalizedControls: {
    model: null,
    collaborationMode: null,
    mode: {
      key: "mode",
      rawConfigId: "mode",
      label: "Mode",
      currentValue: "default",
      settable: true,
      values: [
        { value: "default", label: "Default" },
        { value: "plan", label: "Plan" },
      ],
    },
    reasoning: null,
    effort: {
      key: "effort",
      rawConfigId: "effort",
      label: "Effort",
      currentValue: "high",
      settable: true,
      values: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    },
    fastMode: {
      key: "fast_mode",
      rawConfigId: "fast_mode",
      label: "Fast mode",
      currentValue: "off",
      settable: true,
      values: [
        { value: "off", label: "Off" },
        { value: "on", label: "On" },
      ],
    },
    extras: [],
  },
  sourceSeq: 10,
  updatedAt: "2026-04-08T00:00:00.000Z",
};

describe("pending-config helpers", () => {
  it("overlays only the matching raw config id", () => {
    const pendingConfigChanges: PendingSessionConfigChanges = {
      effort: {
        rawConfigId: "effort",
        value: "medium",
        status: "submitting",
        mutationId: 2,
      },
    };

    expect(resolveDisplayedSessionControlState(
      LIVE_CONFIG.normalizedControls.effort!,
      pendingConfigChanges,
    )).toEqual({
      currentValue: "medium",
      pendingState: "submitting",
    });

    expect(resolveDisplayedSessionControlState(
      LIVE_CONFIG.normalizedControls.fastMode!,
      pendingConfigChanges,
    )).toEqual({
      currentValue: "off",
      pendingState: null,
    });
  });

  it("reconciles only entries whose own authoritative value now matches", () => {
    const pendingConfigChanges: PendingSessionConfigChanges = {
      effort: {
        rawConfigId: "effort",
        value: "high",
        status: "queued",
        mutationId: 1,
      },
      fast_mode: {
        rawConfigId: "fast_mode",
        value: "on",
        status: "queued",
        mutationId: 2,
      },
    };

    const result = reconcilePendingConfigChanges(LIVE_CONFIG, pendingConfigChanges);

    expect(result.reconciledChanges).toEqual([pendingConfigChanges.effort]);
    expect(result.pendingConfigChanges).toEqual({
      fast_mode: pendingConfigChanges.fast_mode,
    });
  });

  it("does not clear an unrelated pending entry when another config updates", () => {
    const pendingConfigChanges: PendingSessionConfigChanges = {
      fast_mode: {
        rawConfigId: "fast_mode",
        value: "on",
        status: "queued",
        mutationId: 2,
      },
    };

    const liveConfigWithOnlyEffortChange: SessionLiveConfigSnapshot = {
      ...LIVE_CONFIG,
      normalizedControls: {
        ...LIVE_CONFIG.normalizedControls,
        effort: {
          ...LIVE_CONFIG.normalizedControls.effort!,
          currentValue: "medium",
        },
      },
      rawConfigOptions: LIVE_CONFIG.rawConfigOptions.map((option) => (
        option.id === "effort"
          ? { ...option, currentValue: "medium" }
          : option
      )),
      sourceSeq: 11,
    };

    const result = reconcilePendingConfigChanges(
      liveConfigWithOnlyEffortChange,
      pendingConfigChanges,
    );

    expect(result.reconciledChanges).toEqual([]);
    expect(result.pendingConfigChanges).toEqual(pendingConfigChanges);
  });

  it("returns only mismatched queued changes as failed", () => {
    const pendingConfigChanges: PendingSessionConfigChanges = {
      effort: {
        rawConfigId: "effort",
        value: "high",
        status: "queued",
        mutationId: 1,
      },
      fast_mode: {
        rawConfigId: "fast_mode",
        value: "on",
        status: "queued",
        mutationId: 2,
      },
      mode: {
        rawConfigId: "mode",
        value: "plan",
        status: "submitting",
        mutationId: 3,
      },
    };

    expect(collectFailedQueuedChanges(LIVE_CONFIG, pendingConfigChanges)).toEqual([
      pendingConfigChanges.fast_mode,
    ]);
  });

  it("captures only queued mutation ids for rollback snapshots", () => {
    const pendingConfigChanges: PendingSessionConfigChanges = {
      effort: {
        rawConfigId: "effort",
        value: "medium",
        status: "queued",
        mutationId: 4,
      },
      fast_mode: {
        rawConfigId: "fast_mode",
        value: "on",
        status: "submitting",
        mutationId: 5,
      },
    };

    expect(snapshotQueuedPendingConfigMutationIds(pendingConfigChanges)).toEqual({
      effort: 4,
    });
  });

  it("only clears failed queued changes that still match the scheduled mutation", () => {
    const pendingConfigChanges: PendingSessionConfigChanges = {
      effort: {
        rawConfigId: "effort",
        value: "medium",
        status: "queued",
        mutationId: 4,
      },
      fast_mode: {
        rawConfigId: "fast_mode",
        value: "on",
        status: "queued",
        mutationId: 6,
      },
    };

    expect(
      collectFailedQueuedChangesMatchingMutationIds(
        LIVE_CONFIG,
        pendingConfigChanges,
        { fast_mode: 5 },
      ),
    ).toEqual([]);

    expect(
      collectFailedQueuedChangesMatchingMutationIds(
        LIVE_CONFIG,
        pendingConfigChanges,
        { fast_mode: 6 },
      ),
    ).toEqual([pendingConfigChanges.fast_mode]);
  });

  it("ignores stale authoritative snapshots by source sequence", () => {
    expect(shouldAcceptAuthoritativeLiveConfig(
      LIVE_CONFIG,
      { ...LIVE_CONFIG, sourceSeq: 9 },
    )).toBe(false);
    expect(shouldAcceptAuthoritativeLiveConfig(
      LIVE_CONFIG,
      { ...LIVE_CONFIG, sourceSeq: 10 },
    )).toBe(true);
    expect(shouldAcceptAuthoritativeLiveConfig(
      LIVE_CONFIG,
      { ...LIVE_CONFIG, sourceSeq: 11 },
    )).toBe(true);
  });

  it("resolves authoritative values by raw config id", () => {
    expect(getAuthoritativeConfigValue(LIVE_CONFIG, "mode")).toBe("default");
    expect(getAuthoritativeConfigValue(LIVE_CONFIG, "fast_mode")).toBe("off");
    expect(getAuthoritativeConfigValue(LIVE_CONFIG, "missing")).toBeNull();
  });
});
