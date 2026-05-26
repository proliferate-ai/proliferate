import { describe, expect, it } from "vitest";
import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import {
  buildCloudWorkInventory,
  buildRecentWorkItems,
  cloudWorkItemForWorkspace,
  cloudCommandReadiness,
  recentWorkCloudAccessState,
  cloudWorkSourceForWorkspace,
  cloudWorkStatusForWorkspace,
  dedupeCloudWorkspaces,
  filterCloudWorkItems,
  recentWorkCommandability,
  recentWorkRuntimeLocationForWorkspace,
  recentWorkSourceForWorkspace,
} from "./cloud-work-inventory";

const NOW = Date.parse("2026-05-23T12:00:00Z");

describe("cloud work inventory", () => {
  it("derives source labels from origin and creator context", () => {
    expect(cloudWorkSourceForWorkspace(workspace({ origin: { kind: "human", entrypoint: "slack" } }))).toBe("slack");
    expect(cloudWorkSourceForWorkspace(workspace({ creatorContext: { kind: "automation" } }))).toBe("automation");
    expect(cloudWorkSourceForWorkspace(workspace({
      origin: { kind: "human", entrypoint: "slack" },
      creatorContext: { kind: "automation" },
    }))).toBe("automation");
    expect(cloudWorkSourceForWorkspace(workspace({ origin: { kind: "api", entrypoint: "api" } }))).toBe("api");
    expect(cloudWorkSourceForWorkspace(workspace({ creatorContext: { kind: "agent" } }))).toBe("chats");
  });

  it("uses only API-backed status categories", () => {
    expect(cloudWorkStatusForWorkspace(workspace({ actionBlockReason: "Missing auth" }))).toBe("blocked");
    expect(cloudWorkStatusForWorkspace(workspace({
      actionBlockReason: "Missing auth",
      lastError: "Runtime failed",
    }))).toBe("error");
    expect(cloudWorkStatusForWorkspace(workspace({ workspaceStatus: "error" }))).toBe("error");
    expect(cloudWorkStatusForWorkspace(workspace({ workspaceStatus: "archived" }))).toBe("archived");
    expect(cloudWorkStatusForWorkspace(workspace({ workspaceStatus: "materializing" }))).toBe("active");
    expect(cloudWorkStatusForWorkspace(workspace({ workspaceStatus: "needs_rematerialization" }))).toBe("active");
    expect(cloudWorkStatusForWorkspace(workspace({ workspaceStatus: "ready", runtime: runtime("running") }))).toBe("ready");
    expect(cloudWorkStatusForWorkspace(workspace({ workspaceStatus: "ready", runtime: runtime("paused") }))).toBe("ready");
  });

  it("dedupes duplicate workspace rows by merging complementary details", () => {
    const sparse = workspace({ id: "same", exposure: null });
    const rich = workspace({
      id: "same",
      exposure: {
        id: "exposure",
        visibility: "shared_unclaimed",
        claimedByUserId: null,
        defaultProjectionLevel: "summary",
        commandable: false,
        status: "active",
      },
      lastSessionSummary: {
        targetId: "target",
        workspaceId: "runtime",
        sessionId: "session",
        title: "Session",
        status: "running",
        lastEventAt: "2026-05-23T11:55:00Z",
      },
    });

    const [deduped] = dedupeCloudWorkspaces([sparse, rich]);

    expect(deduped?.exposure).toEqual(rich.exposure);
    expect(deduped?.lastSessionSummary).toEqual(rich.lastSessionSummary);
    expect(deduped?.repo).toEqual(rich.repo);
  });

  it("builds source groups in product order and sorts by latest activity first", () => {
    const groups = buildCloudWorkInventory([
      workspace({
        id: "slack",
        displayName: "Slack bug",
        origin: { kind: "human", entrypoint: "slack" },
        lastActivityAt: "2026-05-23T11:58:00Z",
      }),
      workspace({
        id: "blocked",
        displayName: "Blocked chat",
        actionBlockReason: "Needs auth",
        lastActivityAt: "2026-05-23T11:00:00Z",
      }),
      workspace({
        id: "recent",
        displayName: "Recent chat",
        lastActivityAt: "2026-05-23T11:59:00Z",
      }),
    ], { nowMs: NOW });

    expect(groups.map((group) => group.id)).toEqual(["chats", "slack"]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["recent", "blocked"]);
    expect(groups[1]?.items[0]?.lastActivityLabel).toBe("2m");
  });

  it("uses latest session activity before workspace activity", () => {
    const groups = buildCloudWorkInventory([
      workspace({
        id: "workspace-activity",
        displayName: "Workspace activity",
        lastActivityAt: "2026-05-23T11:59:00Z",
      }),
      workspace({
        id: "session-activity",
        displayName: "Session activity",
        lastActivityAt: "2026-05-23T10:00:00Z",
        lastSessionSummary: {
          targetId: "target",
          workspaceId: "runtime",
          sessionId: "session",
          title: "Recent session",
          status: "idle",
          lastEventAt: "2026-05-23T11:59:30Z",
        },
      }),
    ], { nowMs: NOW });

    expect(groups[0]?.items.map((item) => item.id)).toEqual(["session-activity", "workspace-activity"]);
  });

  it("dedupes duplicate rows while building the inventory", () => {
    const groups = buildCloudWorkInventory([
      workspace({ id: "same", displayName: "Sparse" }),
      workspace({
        id: "same",
        displayName: "Rich",
        lastSessionSummary: {
          targetId: "target",
          workspaceId: "runtime",
          sessionId: "session",
          title: "Rich session",
          status: "idle",
          lastEventAt: "2026-05-23T11:57:00Z",
        },
      }),
    ], { nowMs: NOW });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]?.id).toBe("same");
    expect(groups[0]?.items[0]?.defaultSessionId).toBe("session");
  });

  it("filters by source, ownership, status, and search", () => {
    const items = [
      cloudWorkItemForWorkspace(workspace({
        id: "private",
        displayName: "Refactor loader",
        runtime: runtime("paused"),
      }), { nowMs: NOW }),
      cloudWorkItemForWorkspace(workspace({
        id: "unclaimed",
        displayName: "Incident from Slack",
        visibility: "shared_unclaimed",
        origin: { kind: "human", entrypoint: "slack" },
        runtime: runtime("paused"),
      }), { nowMs: NOW }),
    ];

    expect(filterCloudWorkItems(items, { ownership: "unclaimed" }).map((item) => item.id)).toEqual(["unclaimed"]);
    expect(filterCloudWorkItems(items, { sources: new Set(["slack"]) }).map((item) => item.id)).toEqual(["unclaimed"]);
    expect(filterCloudWorkItems(items, { statuses: new Set(["ready"]) }).map((item) => item.id)).toEqual(["private", "unclaimed"]);
    expect(filterCloudWorkItems(items, { search: "loader" }).map((item) => item.id)).toEqual(["private"]);
  });

  it("searches by latest session title even when the workspace has a display name", () => {
    const items = [
      cloudWorkItemForWorkspace(workspace({
        displayName: "Workspace name",
        lastSessionSummary: {
          targetId: "target",
          workspaceId: "runtime",
          sessionId: "session",
          title: "Sentry regression triage",
          status: "idle",
          lastEventAt: "2026-05-23T11:55:00Z",
        },
      }), { nowMs: NOW }),
    ];

    expect(filterCloudWorkItems(items, { search: "sentry" }).map((item) => item.id)).toEqual(["workspace"]);
  });

  it("builds mixed recent session and workspace rows with explicit runtime facts", () => {
    const rows = buildRecentWorkItems([
      workspace({
        id: "desktop",
        displayName: "Bramble",
        sandboxType: "local",
        origin: { kind: "human", entrypoint: "desktop" },
        exposure: {
          id: "exposure",
          visibility: "private",
          claimedByUserId: null,
          defaultProjectionLevel: "summary",
          commandable: true,
          status: "active",
        },
        exposureState: "live",
        lastSessionSummary: {
          targetId: "target",
          workspaceId: "runtime",
          sessionId: "session",
          title: "Fix cloud UI",
          status: "running",
          lastEventAt: "2026-05-23T11:58:00Z",
        },
      }),
      workspace({
        id: "empty",
        displayName: "Empty cloud workspace",
        sandboxType: "managed_personal",
        origin: { kind: "human", entrypoint: "web" },
        targetId: "cloud-target",
        lastActivityAt: "2026-05-23T11:00:00Z",
      }),
    ], { nowMs: NOW });

    expect(rows.map((row) => row.id)).toEqual([
      "session:desktop:session",
      "workspace:empty",
    ]);
    expect(rows[0]).toMatchObject({
      rowKind: "session",
      workspaceId: "desktop",
      sessionId: "session",
      title: "Fix cloud UI",
      sourceKind: "desktop_exposed",
      runtimeLocation: "local_desktop",
      cloudAccessState: "enabled",
      commandability: "commandable",
      state: "running",
      lastActivityLabel: "2m",
    });
    expect(rows[1]).toMatchObject({
      rowKind: "workspace",
      workspaceId: "empty",
      sessionId: null,
      sourceKind: "web",
      runtimeLocation: "cloud_sandbox",
      commandability: "commandable",
      state: "idle",
    });
  });

  it("distinguishes cloud access from cloud runtime", () => {
    const localWorkspace = workspace({
      sandboxType: "local",
      exposureState: "stale",
      exposure: {
        id: "exposure",
        visibility: "private",
        claimedByUserId: null,
        defaultProjectionLevel: "summary",
        commandable: false,
        status: "stale",
      },
    });

    expect(recentWorkSourceForWorkspace(localWorkspace)).toBe("desktop_exposed");
    expect(recentWorkRuntimeLocationForWorkspace(localWorkspace)).toBe("offline");
    expect(recentWorkCommandability(localWorkspace)).toBe("stale");
  });

  it("treats managed cloud work as cloud-accessible without desktop exposure", () => {
    const managedWorkspace = workspace({
      sandboxType: "managed_personal",
      exposure: null,
      exposureState: "untracked",
    });

    expect(recentWorkCloudAccessState(managedWorkspace)).toBe("enabled");
  });

  it("requires claim and durable runtime routing before cloud commands", () => {
    expect(cloudCommandReadiness(workspace({
      visibility: "shared_unclaimed",
    })).state).toBe("claim_required");

    expect(cloudCommandReadiness(workspace({
      sandboxType: "managed_personal",
      targetId: "target",
      runtime: runtime("running"),
    })).state).toBe("runtime_unavailable");

    expect(cloudCommandReadiness({
      ...workspace({
        sandboxType: "managed_personal",
        targetId: "target",
        runtime: runtime("running"),
      }),
      anyharnessWorkspaceId: "runtime-workspace",
    }).state).toBe("ready");

    expect(cloudCommandReadiness({
      ...workspace({
        sandboxType: "managed_personal",
        targetId: "target",
        runtime: runtime("provisioning"),
      }),
      anyharnessWorkspaceId: "runtime-workspace",
    }).state).toBe("workspace_not_ready");
  });

  it("surfaces workspace provisioning errors before generic not-ready copy", () => {
    const readiness = cloudCommandReadiness(workspace({
      workspaceStatus: "error",
      status: "error",
      statusDetail: "Connecting to repo runtime",
      lastError: "Managed cloud worker enrollment requires CLOUD_WORKER_BASE_URL to be a public URL reachable from the sandbox.",
    }));

    expect(readiness.state).toBe("runtime_unavailable");
    expect(readiness.message).toContain("CLOUD_WORKER_BASE_URL");
  });
});

type RuntimeSummary = NonNullable<CloudWorkspaceSummary["runtime"]>;

function runtime(status: RuntimeSummary["status"]): RuntimeSummary {
  return {
    environmentId: "env",
    status,
    generation: 1,
    runtimeAuth: null,
    actionBlockKind: null,
    actionBlockReason: null,
  };
}

function workspace(overrides: Partial<CloudWorkspaceSummary> = {}): CloudWorkspaceSummary {
  return {
    id: "workspace",
    targetId: "target",
    displayName: "Workspace",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "main",
      baseBranch: "main",
    },
    workspaceStatus: "ready",
    runtime: runtime("running"),
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    updatedAt: "2026-05-23T11:30:00Z",
    createdAt: "2026-05-23T10:00:00Z",
    actionBlockKind: null,
    actionBlockReason: null,
    postReadyPhase: "complete",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    repoFilesLastFailedPath: null,
    origin: { kind: "human", entrypoint: "mobile" },
    creatorContext: null,
    directTargetContext: null,
    visibility: "private",
    exposure: null,
    exposureState: "untracked",
    sandboxType: "managed_personal",
    lastActivityAt: "2026-05-23T11:45:00Z",
    lastSessionSummary: null,
    claimedByUserId: null,
    claimId: null,
    claimedAt: null,
    claimSourceKind: null,
    billing: null,
    status: "ready",
    ...overrides,
  } as CloudWorkspaceSummary;
}
