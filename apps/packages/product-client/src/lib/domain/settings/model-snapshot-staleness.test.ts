import { describe, expect, it } from "vitest";
import type { ModelSnapshotStatus } from "@anyharness/sdk";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import {
  findContextStatus,
  formatSnapshotAge,
  GATEWAY_AUTH_CONTEXT_ID,
  resolveModelSnapshotFreshness,
} from "./model-snapshot-staleness";

function statusWith(
  contexts: ModelSnapshotStatus["contexts"],
): ModelSnapshotStatus {
  return {
    agent: "codex",
    probeEngine: "owner",
    schemaVersion: 1,
    installIdentity: null,
    contexts,
  };
}

describe("findContextStatus", () => {
  it("finds the context matching the auth context id", () => {
    const status = statusWith([
      { authContextId: "baseline", active: false, state: "idle", identityComparable: true, modelCount: 1, modeCount: 0, stale: false },
      { authContextId: GATEWAY_AUTH_CONTEXT_ID, active: true, state: "idle", identityComparable: true, modelCount: 5, modeCount: 1, stale: false },
    ]);
    const found = findContextStatus(status, GATEWAY_AUTH_CONTEXT_ID);
    expect(found?.authContextId).toBe(GATEWAY_AUTH_CONTEXT_ID);
  });

  it("returns null when the status document is absent or the context is missing", () => {
    expect(findContextStatus(undefined, GATEWAY_AUTH_CONTEXT_ID)).toBeNull();
    expect(findContextStatus(statusWith([]), GATEWAY_AUTH_CONTEXT_ID)).toBeNull();
  });
});

describe("resolveModelSnapshotFreshness", () => {
  it("is unknown when no context status exists yet", () => {
    expect(resolveModelSnapshotFreshness(null)).toEqual({ kind: "unknown" });
  });

  it("is refreshing while queued or running", () => {
    expect(resolveModelSnapshotFreshness({
      authContextId: "gateway", active: true, state: "queued", identityComparable: true,
      modelCount: 0, modeCount: 0, stale: false,
    })).toEqual({ kind: "refreshing" });
    expect(resolveModelSnapshotFreshness({
      authContextId: "gateway", active: true, state: "running", identityComparable: true,
      modelCount: 0, modeCount: 0, stale: false,
    })).toEqual({ kind: "refreshing" });
  });

  it("is stale when the server marks it stale, even if idle", () => {
    expect(resolveModelSnapshotFreshness({
      authContextId: "gateway", active: true, state: "idle", identityComparable: true,
      modelCount: 3, modeCount: 1, stale: true,
    })).toEqual({ kind: "stale" });
  });

  it("is fresh with the reported age when idle and not stale", () => {
    expect(resolveModelSnapshotFreshness({
      authContextId: "gateway", active: true, state: "idle", identityComparable: true,
      modelCount: 3, modeCount: 1, stale: false, snapshotAgeSeconds: 42,
    })).toEqual({ kind: "fresh", ageSeconds: 42 });
  });

  it("is unknown when idle, not stale, but age was never observed", () => {
    expect(resolveModelSnapshotFreshness({
      authContextId: "gateway", active: true, state: "idle", identityComparable: true,
      modelCount: 0, modeCount: 0, stale: false,
    })).toEqual({ kind: "unknown" });
  });

  it("treats backoff as neither refreshing nor fresh — it surfaces via stale/unknown", () => {
    expect(resolveModelSnapshotFreshness({
      authContextId: "gateway", active: true, state: "backoff", identityComparable: true,
      modelCount: 0, modeCount: 0, stale: true,
    })).toEqual({ kind: "stale" });
  });
});

describe("formatSnapshotAge", () => {
  it("formats sub-minute ages as just now", () => {
    expect(formatSnapshotAge(0)).toBe("just now");
    expect(formatSnapshotAge(59)).toBe("just now");
  });

  it("formats minutes, hours, and days", () => {
    expect(formatSnapshotAge(90)).toBe("1m");
    expect(formatSnapshotAge(3600)).toBe("1h");
    expect(formatSnapshotAge(90000)).toBe("1d");
  });

  it("clamps negative ages to zero", () => {
    expect(formatSnapshotAge(-5)).toBe("just now");
  });
});

describe("HARNESS_PANE_COPY.allModelsFreshRefreshedAgo (composed string)", () => {
  it("reads \"refreshed just now\" for sub-minute ages, never \"refreshed just now ago\"", () => {
    const composed = HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(formatSnapshotAge(0));
    expect(composed).toBe("refreshed just now");
    expect(composed).not.toContain("just now ago");
  });

  it("reads \"refreshed Nm/h/d ago\" for a minute-or-larger age", () => {
    expect(HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(formatSnapshotAge(90))).toBe(
      "refreshed 1m ago",
    );
    expect(HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(formatSnapshotAge(3600))).toBe(
      "refreshed 1h ago",
    );
    expect(HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(formatSnapshotAge(90000))).toBe(
      "refreshed 1d ago",
    );
  });
});
