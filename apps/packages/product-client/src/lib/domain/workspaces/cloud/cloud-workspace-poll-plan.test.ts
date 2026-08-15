import { describe, expect, it } from "vitest";
import {
  awaitingCloudWorkspaceEntryFixture,
  cloudWorkspaceFixture as cloudWorkspace,
} from "#product/test/cloud-workspace-fixtures";
import {
  resolveCloudWorkspaceFailureMessage,
  resolveCloudWorkspacePollAction,
  resolveCloudWorkspacePollOutcome,
  selectCloudWorkspacePollBatch,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-poll-plan";

const awaitingEntry = () => awaitingCloudWorkspaceEntryFixture("attempt-1", "cloud:cloud-1");

describe("resolveCloudWorkspacePollAction", () => {
  it("skips an entry that is not awaiting cloud readiness", () => {
    expect(resolveCloudWorkspacePollAction({
      entry: { ...awaitingEntry(), stage: "submitting" },
      cachedWorkspace: cloudWorkspace({ status: "pending" }),
    })).toBe("skip");
  });

  it("refreshes an entry whose workspace has not landed in the cache yet", () => {
    expect(resolveCloudWorkspacePollAction({
      entry: awaitingEntry(),
      cachedWorkspace: null,
    })).toBe("refresh");
  });

  it("fails from the cache without a round trip when provisioning already errored", () => {
    expect(resolveCloudWorkspacePollAction({
      entry: awaitingEntry(),
      cachedWorkspace: cloudWorkspace({ status: "error" }),
    })).toBe("fail-cached");
  });

  it("still refreshes a cached-ready workspace so finalization sees the same payload", () => {
    expect(resolveCloudWorkspacePollAction({
      entry: awaitingEntry(),
      cachedWorkspace: cloudWorkspace({ status: "ready" }),
    })).toBe("refresh");
  });

  it("fails a workspace that can no longer become ready", () => {
    // Terminal and not ready: refreshing it would park the attempt and its
    // queued prompt until the hour-long staleness sweep.
    expect(resolveCloudWorkspacePollAction({
      entry: awaitingEntry(),
      cachedWorkspace: cloudWorkspace({ status: "lost" }),
    })).toBe("fail-cached");
    expect(resolveCloudWorkspacePollAction({
      entry: awaitingEntry(),
      cachedWorkspace: cloudWorkspace({ status: "archived" }),
    })).toBe("fail-cached");
  });
});

describe("resolveCloudWorkspacePollOutcome", () => {
  it("holds a ready workspace that is still applying files", () => {
    expect(resolveCloudWorkspacePollOutcome({
      ...cloudWorkspace({ status: "ready" }),
      postReadyPhase: "applying_files",
    })).toBe("pending");
  });

  it("reads ready and error straight off the status", () => {
    expect(resolveCloudWorkspacePollOutcome(cloudWorkspace({ status: "ready" }))).toBe("ready");
    expect(resolveCloudWorkspacePollOutcome(cloudWorkspace({ status: "error" }))).toBe("failed");
    expect(resolveCloudWorkspacePollOutcome(cloudWorkspace({ status: "pending" }))).toBe("pending");
  });

  it("treats a terminal non-ready status as a failure, not as waiting", () => {
    expect(resolveCloudWorkspacePollOutcome(cloudWorkspace({ status: "lost" }))).toBe("failed");
    expect(resolveCloudWorkspacePollOutcome(cloudWorkspace({ status: "archived" }))).toBe("failed");
  });
});

describe("resolveCloudWorkspaceFailureMessage", () => {
  it("prefers what the workspace reported", () => {
    expect(resolveCloudWorkspaceFailureMessage({
      ...cloudWorkspace({ status: "error" }),
      lastError: "Sandbox never started",
    })).toBe("Sandbox never started");
  });

  it("says what a terminal status means when it carries no error text", () => {
    expect(resolveCloudWorkspaceFailureMessage(cloudWorkspace({ status: "lost" })))
      .toBe("Cloud workspace was lost before it became ready.");
    expect(resolveCloudWorkspaceFailureMessage(cloudWorkspace({ status: "archived" })))
      .toBe("Cloud workspace was archived before it became ready.");
    expect(resolveCloudWorkspaceFailureMessage(cloudWorkspace({ status: "error" })))
      .toBe("Cloud workspace provisioning failed.");
  });
});

describe("selectCloudWorkspacePollBatch", () => {
  it("caps the batch and carries the cursor so no attempt starves", () => {
    const candidates = ["a", "b", "c", "d"];

    const first = selectCloudWorkspacePollBatch(candidates, 0, 3);
    expect(first.batch).toEqual(["a", "b", "c"]);

    const second = selectCloudWorkspacePollBatch(candidates, first.nextCursor, 3);
    expect(second.batch).toEqual(["d", "a", "b"]);
  });

  it("returns every candidate when there are fewer than the cap", () => {
    expect(selectCloudWorkspacePollBatch(["a", "b"], 0, 3).batch).toEqual(["a", "b"]);
  });

  it("handles an empty candidate list", () => {
    expect(selectCloudWorkspacePollBatch([], 2, 3)).toEqual({ batch: [], nextCursor: 0 });
  });
});
