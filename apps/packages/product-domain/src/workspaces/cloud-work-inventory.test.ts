import { describe, expect, it } from "vitest";
import type { CloudSessionProjection, CloudWorkspaceSummary } from "@proliferate/cloud-sdk";

import {
  buildCloudWorkInventory,
  buildCloudWorkRecencyInventory,
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
  recentWorkStatusIndicatorForWorkspace,
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
    expect(cloudWorkStatusForWorkspace(workspace({
      sandboxType: "local",
      workspaceStatus: "ready",
      runtime: runtime("pending", { environmentId: null }),
    }))).toBe("ready");
    expect(cloudWorkStatusForWorkspace(workspace({
      sandboxType: "managed_personal",
      workspaceStatus: "ready",
      runtime: runtime("pending", { environmentId: null }),
    }))).toBe("active");
    expect(cloudWorkStatusForWorkspace(workspace({
      workspaceStatus: "ready",
      runtime: runtime("running"),
      lastSessionSummary: {
        targetId: "target",
        workspaceId: "runtime",
        sessionId: "session",
        title: "Running session",
        status: "running",
        lastEventAt: "2026-05-23T11:55:00Z",
      },
    }))).toBe("running");
    expect(cloudWorkStatusForWorkspace(workspace({
      workspaceStatus: "ready",
      runtime: runtime("running"),
      lastSessionSummary: {
        targetId: "target",
        workspaceId: "runtime",
        sessionId: "session",
        title: "Awaiting approval",
        status: "idle",
        phase: "awaiting_interaction",
        pendingInteractionCount: 1,
        lastEventAt: "2026-05-23T11:56:00Z",
      },
    }))).toBe("blocked");
    expect(cloudWorkStatusForWorkspace(workspace({ workspaceStatus: "ready", runtime: runtime("paused") }))).toBe("ready");
  });

  it("derives a shared status indicator without requiring server UI fields", () => {
    expect(recentWorkStatusIndicatorForWorkspace(workspace({
      workspaceStatus: "error",
      lastError: "Runtime failed",
    }))).toMatchObject({ kind: "error", tone: "danger", label: "Error", hollow: false });

    expect(recentWorkStatusIndicatorForWorkspace(workspace({
      lastSessionSummary: {
        targetId: "target",
        workspaceId: "runtime",
        sessionId: "session",
        title: "Awaiting approval",
        status: "idle",
        phase: "awaiting_interaction",
        pendingInteractionCount: 1,
        lastEventAt: "2026-05-23T11:56:00Z",
      },
    }))).toMatchObject({ kind: "needs_input", tone: "attention", label: "Needs input" });

    expect(recentWorkStatusIndicatorForWorkspace(workspace({
      workspaceStatus: "materializing",
      status: "materializing",
      runtime: runtime("provisioning"),
    }))).toMatchObject({ kind: "running", tone: "progress", label: "In progress", live: true });
    expect(recentWorkStatusIndicatorForWorkspace(workspace({
      sandboxType: "local",
      exposureState: "tracked",
      exposure: {
        id: "exposure",
        visibility: "private",
        claimedByUserId: null,
        defaultProjectionLevel: "live",
        commandable: true,
        status: "active",
      },
      workspaceStatus: "ready",
      status: "ready",
      runtime: runtime("pending", { environmentId: null }),
    }))).toMatchObject({ kind: "ready", tone: "success", label: "Ready", live: false });
    expect(recentWorkStatusIndicatorForWorkspace(workspace({
      sandboxType: "managed_personal",
      workspaceStatus: "ready",
      status: "ready",
      runtime: runtime("pending", { environmentId: null }),
    }))).toMatchObject({ kind: "running", tone: "progress", label: "In progress", live: true });

    expect(recentWorkStatusIndicatorForWorkspace(workspace({
      lastSessionSummary: {
        targetId: "target",
        workspaceId: "runtime",
        sessionId: "session",
        title: "Review",
        status: "ready_for_review",
        lastEventAt: "2026-05-23T11:56:00Z",
      },
    }))).toMatchObject({ kind: "review_ready", tone: "success", label: "Ready for review" });

    expect(recentWorkStatusIndicatorForWorkspace(workspace({
      sandboxType: "managed_personal",
      targetId: "target",
      anyharnessWorkspaceId: "runtime-workspace",
      runtime: runtime("running"),
    }))).toMatchObject({ kind: "ready", tone: "success", label: "Ready" });

    expect(recentWorkStatusIndicatorForWorkspace(workspace({
      sandboxType: "managed_personal",
      targetId: "target",
      runtime: runtime("running"),
    }))).toMatchObject({ kind: "idle", tone: "muted", label: "Idle" });

    expect(recentWorkStatusIndicatorForWorkspace(workspace({
      lastSessionSummary: {
        targetId: "target",
        workspaceId: "runtime",
        sessionId: "session",
        title: "Failed session",
        status: "failed",
        lastEventAt: "2026-05-23T11:56:00Z",
      },
    }))).toMatchObject({ kind: "error", tone: "danger", label: "Error" });

    expect(recentWorkStatusIndicatorForWorkspace(workspace({
      sandboxType: "local",
      exposureState: "untracked",
      exposure: null,
      runtime: runtime("running"),
    }))).toMatchObject({ kind: "idle", tone: "muted", label: "Idle", hollow: true });
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

  it("includes billing-blocked work in needs-attention filters", () => {
    const groups = buildCloudWorkInventory([
      workspace({
        id: "billing-blocked",
        displayName: "Billing blocked",
        billing: {
          plan: "free",
          billingMode: "free",
          blockStatus: "allowed",
          overageEnabled: false,
          overageUsedCentsThisPeriod: 0,
          startBlocked: true,
          activeSpendHold: false,
          activeSandboxCount: 0,
        },
      }),
      workspace({
        id: "quiet",
        displayName: "Quiet",
      }),
    ], {
      filters: { needsAttention: true },
      nowMs: NOW,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]).toMatchObject({
      id: "billing-blocked",
      status: "ready",
      statusIndicator: { kind: "needs_input", label: "Needs input" },
    });
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

  it("carries the last session agent kind into workspace rows", () => {
    const item = cloudWorkItemForWorkspace(workspace({
      lastSessionSummary: {
        targetId: "target",
        workspaceId: "runtime",
        sessionId: "session",
        sourceAgentKind: "codex",
        title: "Codex session",
        status: "idle",
        lastEventAt: "2026-05-23T11:57:00Z",
      },
    }), { nowMs: NOW });

    expect(item.sourceAgentKind).toBe("codex");
    expect(item.searchText).toContain("codex");
  });

  it("uses the latest session preview as the workspace card activity text", () => {
    const item = cloudWorkItemForWorkspace(workspace({
      displayName: "Workspace name",
      lastSessionSummary: {
        targetId: "target",
        workspaceId: "runtime",
        sessionId: "session",
        title: "Session title",
        status: "idle",
        lastEventAt: "2026-05-23T11:57:00Z",
        preview: "I fixed the mobile workspace list preview.",
      },
    }), { nowMs: NOW });

    expect(item.activityPreview).toBe("I fixed the mobile workspace list preview.");
    expect(item.searchText).toContain("mobile workspace list");
    expect(item.statusIndicator.kind).toBe("idle");
  });

  it("falls back to specific blocker detail instead of blunt status copy", () => {
    const item = cloudWorkItemForWorkspace(workspace({
      lastError: "Runtime failed while starting",
      workspaceStatus: "error",
    }), { nowMs: NOW });

    expect(item.statusLabel).toBe("Error");
    expect(item.activityPreview).toBe("Runtime failed while starting");
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

  it("filters by semantic source and runtime location for mobile workspace views", () => {
    const items = [
      cloudWorkItemForWorkspace(workspace({
        id: "desktop",
        displayName: "Desktop dispatch",
        sandboxType: "local",
        origin: { kind: "human", entrypoint: "desktop" },
        exposureState: "live",
      }), { nowMs: NOW }),
      cloudWorkItemForWorkspace(workspace({
        id: "cloud",
        displayName: "Cloud launch",
        sandboxType: "managed_personal",
        origin: { kind: "human", entrypoint: "web" },
      }), { nowMs: NOW }),
      cloudWorkItemForWorkspace(workspace({
        id: "slack",
        displayName: "Slack handoff",
        origin: { kind: "human", entrypoint: "slack" },
        claimSourceKind: "slack",
        visibility: "shared_unclaimed",
      }), { nowMs: NOW }),
      cloudWorkItemForWorkspace(workspace({
        id: "mobile-dispatch",
        displayName: "Mobile dispatch",
        sandboxType: "local",
        origin: { kind: "human", entrypoint: "mobile" },
      }), { nowMs: NOW }),
    ];

    expect(
      filterCloudWorkItems(items, { semanticSources: new Set(["desktop_exposed"]) })
        .map((item) => item.id),
    ).toEqual(["desktop"]);
    expect(
      filterCloudWorkItems(items, { semanticSources: new Set(["slack"]) })
        .map((item) => item.id),
    ).toEqual(["slack"]);
    expect(
      filterCloudWorkItems(items, { runtimeLocations: new Set(["cloud_sandbox"]) })
        .map((item) => item.id),
    ).toEqual(["cloud", "slack"]);
    expect(
      filterCloudWorkItems(items, { needsAttention: true })
        .map((item) => item.id),
    ).toEqual(["slack"]);
    expect(
      filterCloudWorkItems(items, { semanticSources: new Set(["mobile"]) })
        .map((item) => item.id),
    ).toEqual(["mobile-dispatch"]);
  });

  it("filters by repo label and sorts workspace rows for mobile sheets", () => {
    const groups = buildCloudWorkRecencyInventory([
      workspace({
        id: "zeta",
        displayName: "Zeta work",
        repo: { owner: "proliferate-ai", name: "proliferate", branch: "main", baseBranch: "main" },
        lastActivityAt: "2026-05-23T11:59:00Z",
      }),
      workspace({
        id: "alpha",
        displayName: "Alpha work",
        repo: { owner: "proliferate-ai", name: "proliferate", branch: "main", baseBranch: "main" },
        lastActivityAt: "2026-05-23T11:00:00Z",
      }),
      workspace({
        id: "other-repo",
        displayName: "Beta work",
        repo: { owner: "proliferate-ai", name: "website", branch: "main", baseBranch: "main" },
        lastActivityAt: "2026-05-23T11:30:00Z",
      }),
    ], {
      nowMs: NOW,
      filters: {
        repoLabels: new Set(["proliferate-ai/proliferate"]),
        sort: "name",
      },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["alpha", "zeta"]);
  });

  it("groups workspace rows by recency for mobile lists", () => {
    const groups = buildCloudWorkRecencyInventory([
      workspace({ id: "today", lastActivityAt: "2026-05-23T11:00:00Z" }),
      workspace({ id: "this-week", lastActivityAt: "2026-05-20T12:00:00Z" }),
      workspace({ id: "last-week", lastActivityAt: "2026-05-12T12:00:00Z" }),
      workspace({ id: "earlier", lastActivityAt: "2026-04-01T12:00:00Z" }),
    ], { nowMs: NOW });

    expect(groups.map((group) => group.id)).toEqual(["today", "this_week", "last_week", "earlier"]);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["today"],
      ["this-week"],
      ["last-week"],
      ["earlier"],
    ]);
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
      statusIndicator: { kind: "running", label: "In progress" },
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
      statusIndicator: { kind: "idle", label: "Idle" },
    });
  });

  it("carries latest session previews into recent work rows", () => {
    const rows = buildRecentWorkItems([
      workspace({
        id: "with-preview",
        displayName: "Preview workspace",
        lastSessionSummary: {
          targetId: "target",
          workspaceId: "runtime",
          sessionId: "session",
          title: "Session title",
          status: "idle",
          lastEventAt: "2026-05-23T11:58:00Z",
          preview: "Want me to drill into one zone?",
        },
      }),
    ], { nowMs: NOW });

    expect(rows[0]).toMatchObject({
      id: "session:with-preview:session",
      activityPreview: "Want me to drill into one zone?",
      statusIndicator: { kind: "idle" },
    });
    expect(rows[0]?.searchText).toContain("drill into one zone");
  });

  it("keeps the active workspace row even when that workspace has recent sessions", () => {
    const rows = buildRecentWorkItems([
      workspace({
        id: "desktop",
        displayName: "Bramble",
        sandboxType: "local",
        origin: { kind: "human", entrypoint: "desktop" },
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
    ], {
      activeWorkspaceId: "desktop",
      nowMs: NOW,
    });

    expect(rows.map((row) => row.id)).toEqual([
      "session:desktop:session",
      "workspace:desktop",
      "workspace:empty",
    ]);
    expect(rows[1]).toMatchObject({
      rowKind: "workspace",
      workspaceId: "desktop",
      sessionId: null,
      title: "Bramble",
    });
  });

  it("keeps active session projection status separate from the workspace last session", () => {
    const rows = buildRecentWorkItems([
      workspace({
        id: "multi-session",
        displayName: "Multi session",
        lastSessionSummary: {
          targetId: "target",
          workspaceId: "runtime",
          sessionId: "needs-input-session",
          title: "Needs input session",
          status: "idle",
          phase: "awaiting_interaction",
          pendingInteractionCount: 1,
          lastEventAt: "2026-05-23T11:58:00Z",
        },
      }),
    ], {
      activeWorkspaceSessions: [
        sessionProjection({
          cloudWorkspaceId: "multi-session",
          sessionId: "running-session",
          title: "Running session",
          status: "running",
          pendingInteractionCount: 0,
          lastEventAt: "2026-05-23T11:59:00Z",
        }),
      ],
      nowMs: NOW,
    });

    const runningSession = rows.find((row) => row.sessionId === "running-session");
    const needsInputSession = rows.find((row) => row.sessionId === "needs-input-session");

    expect(runningSession?.statusIndicator).toMatchObject({ kind: "running", label: "In progress" });
    expect(needsInputSession?.statusIndicator).toMatchObject({ kind: "needs_input", label: "Needs input" });
  });

  it("distinguishes cloud access from cloud runtime", () => {
    const localWorkspace = workspace({
      sandboxType: "local",
      origin: { kind: "human", entrypoint: "desktop" },
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

  it("trusts active managed cloud exposure routing when runtime summary lags", () => {
    const laggingWorkspace = {
      ...workspace({
        sandboxType: "managed_personal",
        targetId: "target",
        runtime: runtime("pending"),
        exposureState: "tracked",
        exposure: {
          id: "exposure",
          visibility: "private",
          claimedByUserId: null,
          defaultProjectionLevel: "live",
          commandable: true,
          status: "active",
        },
      }),
      anyharnessWorkspaceId: "runtime-workspace",
    };
    const readiness = cloudCommandReadiness(laggingWorkspace);

    expect(readiness.state).toBe("ready");
    expect(readiness.commandable).toBe(true);
    expect(recentWorkStatusIndicatorForWorkspace(laggingWorkspace)).toMatchObject({
      kind: "ready",
      tone: "success",
      label: "Ready",
    });
    expect(cloudWorkStatusForWorkspace(laggingWorkspace)).toBe("ready");
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

  it("does not surface ready status detail as an error message", () => {
    const readiness = cloudCommandReadiness(workspace({
      workspaceStatus: "materializing",
      status: "materializing",
      statusDetail: "Ready",
      runtime: runtime("provisioning"),
    }));

    expect(readiness.state).toBe("workspace_not_ready");
    expect(readiness.message).toBe("Workspace runtime is not ready yet. Try again when setup finishes.");
  });
});

type RuntimeSummary = NonNullable<CloudWorkspaceSummary["runtime"]>;

function runtime(status: RuntimeSummary["status"], overrides: Partial<RuntimeSummary> = {}): RuntimeSummary {
  return {
    environmentId: "env",
    status,
    generation: 1,
    runtimeAuth: null,
    actionBlockKind: null,
    actionBlockReason: null,
    ...overrides,
  };
}

function sessionProjection(overrides: Partial<CloudSessionProjection> = {}): CloudSessionProjection {
  return {
    targetId: "target",
    cloudWorkspaceId: "workspace",
    workspaceId: "runtime",
    sessionId: "session",
    nativeSessionId: null,
    sourceAgentKind: "codex",
    title: "Session",
    status: "idle",
    phase: null,
    pendingInteractionCount: 0,
    liveConfig: null,
    lastEventSeq: 1,
    lastEventAt: "2026-05-23T11:45:00Z",
    startedAt: "2026-05-23T11:00:00Z",
    endedAt: null,
    ...overrides,
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
