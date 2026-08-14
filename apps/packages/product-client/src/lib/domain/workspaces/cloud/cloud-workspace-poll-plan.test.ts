import { describe, expect, it } from "vitest";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  resolveCloudWorkspacePollAction,
  resolveCloudWorkspacePollOutcome,
  selectCloudWorkspacePollBatch,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-poll-plan";

describe("resolveCloudWorkspacePollAction", () => {
  it("skips an entry that is not awaiting cloud readiness", () => {
    expect(resolveCloudWorkspacePollAction({
      entry: { ...awaitingEntry(), stage: "submitting" },
      cachedWorkspace: cloudWorkspace("pending"),
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
      cachedWorkspace: cloudWorkspace("error"),
    })).toBe("fail-cached");
  });

  it("still refreshes a cached-ready workspace so finalization sees the same payload", () => {
    expect(resolveCloudWorkspacePollAction({
      entry: awaitingEntry(),
      cachedWorkspace: cloudWorkspace("ready"),
    })).toBe("refresh");
  });

  it("skips a workspace that can no longer become ready", () => {
    expect(resolveCloudWorkspacePollAction({
      entry: awaitingEntry(),
      cachedWorkspace: cloudWorkspace("lost"),
    })).toBe("skip");
  });
});

describe("resolveCloudWorkspacePollOutcome", () => {
  it("holds a ready workspace that is still applying files", () => {
    expect(resolveCloudWorkspacePollOutcome({
      ...cloudWorkspace("ready"),
      postReadyPhase: "applying_files",
    })).toBe("pending");
  });

  it("reads ready and error straight off the status", () => {
    expect(resolveCloudWorkspacePollOutcome(cloudWorkspace("ready"))).toBe("ready");
    expect(resolveCloudWorkspacePollOutcome(cloudWorkspace("error"))).toBe("failed");
    expect(resolveCloudWorkspacePollOutcome(cloudWorkspace("pending"))).toBe("pending");
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

function awaitingEntry(): PendingWorkspaceEntry {
  return {
    ...buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "cloud-created",
      displayName: "feature-branch",
      request: { kind: "select-existing", workspaceId: "cloud:cloud-1" },
    }),
    stage: "awaiting-cloud-ready",
    workspaceId: "cloud:cloud-1",
  };
}

function cloudWorkspace(status: CloudWorkspaceSummary["status"]): CloudWorkspaceSummary {
  return {
    id: "cloud-1",
    displayName: "feature-branch",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "feature-branch",
      baseBranch: "main",
    },
    status,
    workspaceStatus: status,
    runtime: undefined,
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    updatedAt: null,
    createdAt: null,
    readyAt: status === "ready" ? "2026-04-14T00:00:00Z" : null,
    postReadyPhase: "",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    visibility: "private",
  };
}
