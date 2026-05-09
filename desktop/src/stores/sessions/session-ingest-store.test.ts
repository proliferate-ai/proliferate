import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HotSessionTarget } from "@/lib/domain/sessions/hot-session-policy";
import {
  isHotSessionTargetCurrent,
  useSessionIngestStore,
} from "@/stores/sessions/session-ingest-store";

describe("session ingest store invariants", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T00:00:00.000Z"));
    useSessionIngestStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments hot set generation only when target identity changes", () => {
    const store = useSessionIngestStore.getState();
    const generation = store.setHotTargets([
      target("session-b", { priority: 4 }),
      target("session-a", { priority: 0 }),
    ]);

    expect(generation).toBe(1);
    expect(store.setHotTargets([
      target("session-a", { priority: 0 }),
      target("session-b", { priority: 4 }),
    ])).toBe(1);
    expect(store.setHotTargets([
      target("session-a", { priority: 0 }),
      target("session-b", { priority: 3, reason: "running" }),
    ])).toBe(2);
  });

  it("keeps removed hot targets cold while preserving their sequence history", () => {
    const store = useSessionIngestStore.getState();
    store.setHotTargets([target("session-a")]);
    store.applyStreamProgress("session-a", {
      lastAppliedSeq: 4,
      lastObservedSeq: 5,
      gapAfterSeq: 4,
    });

    store.setHotTargets([]);

    expect(useSessionIngestStore.getState().freshnessByClientSessionId["session-a"])
      .toEqual({
        freshness: "cold",
        lastAppliedSeq: 4,
        lastObservedSeq: 5,
        gapAfterSeq: 4,
        lastErrorAt: "2026-04-04T00:00:00.000Z",
      });
  });

  it("guards currentness by generation, materialized id, and streamability", () => {
    const generation = useSessionIngestStore.getState().setHotTargets([
      target("session-a", { materializedSessionId: "runtime-a", streamable: true }),
      target("session-b", { materializedSessionId: null, streamable: false }),
    ]);

    expect(isHotSessionTargetCurrent("session-a", generation, "runtime-a")).toBe(true);
    expect(isHotSessionTargetCurrent("session-a", generation - 1, "runtime-a")).toBe(false);
    expect(isHotSessionTargetCurrent("session-a", generation, "runtime-old")).toBe(false);
    expect(isHotSessionTargetCurrent("session-b", generation, null)).toBe(false);
  });

  it("does not mark gapped progress current until the gap clears", () => {
    const store = useSessionIngestStore.getState();
    store.markStale("session-a", {
      lastAppliedSeq: 2,
      lastObservedSeq: 5,
      gapAfterSeq: 2,
      lastErrorAt: "2026-04-04T00:00:10.000Z",
    });

    store.markCurrentIfContiguous("session-a", 5);
    expect(useSessionIngestStore.getState().freshnessByClientSessionId["session-a"])
      .toMatchObject({
        freshness: "stale",
        lastAppliedSeq: 2,
        lastObservedSeq: 5,
        gapAfterSeq: 2,
        lastErrorAt: "2026-04-04T00:00:10.000Z",
      });

    store.applyStreamProgress("session-a", {
      lastAppliedSeq: 5,
      lastObservedSeq: 5,
      gapAfterSeq: null,
    });

    expect(useSessionIngestStore.getState().freshnessByClientSessionId["session-a"])
      .toEqual({
        freshness: "current",
        lastAppliedSeq: 5,
        lastObservedSeq: 5,
        gapAfterSeq: null,
        lastErrorAt: null,
      });
  });
});

function target(
  clientSessionId: string,
  overrides: Partial<HotSessionTarget> = {},
): HotSessionTarget {
  return {
    clientSessionId,
    materializedSessionId: clientSessionId,
    workspaceId: "workspace-a",
    priority: 0,
    reason: "selected",
    streamable: true,
    ...overrides,
  };
}
