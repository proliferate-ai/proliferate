import { describe, expect, it } from "vitest";
import {
  collectRunningLocalSessionIds,
  isLocalWorkspaceId,
  type RunningLocalSessionCandidate,
} from "./running-local-sessions";

function candidate(
  workspaceId: string | null,
  status: "running" | "idle" | "closed",
  options?: { pendingInteraction?: boolean },
): RunningLocalSessionCandidate {
  return {
    workspaceId,
    status,
    transcript: {
      isStreaming: false,
      pendingInteractions: options?.pendingInteraction ? [{ requestId: "req-1" }] : [],
    },
  };
}

describe("isLocalWorkspaceId", () => {
  it("treats plain workspace ids as local", () => {
    expect(isLocalWorkspaceId("ws-1")).toBe(true);
  });

  it("rejects cloud and target synthetic ids and missing ids", () => {
    expect(isLocalWorkspaceId("cloud:cw-1")).toBe(false);
    expect(isLocalWorkspaceId("target:tgt-1:ws-1")).toBe(false);
    expect(isLocalWorkspaceId(null)).toBe(false);
    expect(isLocalWorkspaceId(undefined)).toBe(false);
  });
});

describe("collectRunningLocalSessionIds", () => {
  it("collects only live local sessions", () => {
    const sessions: Record<string, RunningLocalSessionCandidate> = {
      "local-working": candidate("ws-1", "running"),
      "local-needs-input": candidate("ws-1", "idle", { pendingInteraction: true }),
      "local-idle": candidate("ws-1", "idle"),
      "local-closed": candidate("ws-1", "closed"),
      "cloud-working": candidate("cloud:cw-1", "running"),
      "target-working": candidate("target:tgt-1:ws-9", "running"),
      "unassigned-working": candidate(null, "running"),
    };

    expect(collectRunningLocalSessionIds(sessions)).toEqual([
      "local-working",
      "local-needs-input",
    ]);
  });

  it("returns an empty list when nothing is running locally", () => {
    expect(collectRunningLocalSessionIds({})).toEqual([]);
    expect(
      collectRunningLocalSessionIds({ idle: candidate("ws-1", "idle") }),
    ).toEqual([]);
  });
});
