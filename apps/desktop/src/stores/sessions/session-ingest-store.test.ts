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

  it("tracks hot targets by client session id", () => {
    const store = useSessionIngestStore.getState();
    store.setHotTargets([
      target("session-b", { priority: 4 }),
      target("session-a", { priority: 0 }),
    ]);

    expect(Object.keys(useSessionIngestStore.getState().targetsByClientSessionId).sort())
      .toEqual(["session-a", "session-b"]);

    store.setHotTargets([
      target("session-a", { priority: 0 }),
      target("session-b", { priority: 4 }),
    ]);
    expect(useSessionIngestStore.getState().targetsByClientSessionId["session-b"]?.priority)
      .toBe(4);

    store.setHotTargets([
      target("session-a", { priority: 0 }),
      target("session-b", { priority: 3, reason: "running" }),
    ]);
    expect(useSessionIngestStore.getState().targetsByClientSessionId["session-b"])
      .toMatchObject({ priority: 3, reason: "running" });
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

  it("keeps currentness across reason-only target changes", () => {
    useSessionIngestStore.getState().setHotTargets([
      target("session-a", { materializedSessionId: "runtime-a", streamable: true }),
      target("session-b", { materializedSessionId: null, streamable: false }),
    ]);

    expect(isHotSessionTargetCurrent("session-a", "runtime-a")).toBe(true);
    useSessionIngestStore.getState().setHotTargets([
      target("session-a", {
        materializedSessionId: "runtime-a",
        priority: 3,
        reason: "running",
        streamable: true,
      }),
      target("session-b", { materializedSessionId: null, streamable: false }),
    ]);

    expect(isHotSessionTargetCurrent("session-a", "runtime-a")).toBe(true);
    expect(isHotSessionTargetCurrent("session-a", "runtime-old")).toBe(false);
    expect(isHotSessionTargetCurrent("session-b", null)).toBe(false);

    useSessionIngestStore.getState().setHotTargets([]);
    expect(isHotSessionTargetCurrent("session-a", "runtime-a")).toBe(false);
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
