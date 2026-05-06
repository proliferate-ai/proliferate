import { describe, expect, it, vi } from "vitest";
import type { AnyHarnessClient, Workspace } from "@anyharness/sdk";
import type {
  LocalAutomationMutationResponse,
  LocalAutomationRunClaimResponse,
} from "@/lib/integrations/cloud/client";
import type {
  LocalAutomationRepoCandidate,
  LocalAutomationWorktreePlan,
} from "@/lib/domain/automations/local-executor";
import { executeLocalAutomationRun } from "./automation-local-executor";

const accepted = (): LocalAutomationMutationResponse => ({
  accepted: true,
  run: null,
});

function claim(overrides: Partial<LocalAutomationRunClaimResponse> = {}): LocalAutomationRunClaimResponse {
  return {
    id: "fd253849-c4fe-4ec9-ade6-9dde6533bb64",
    automationId: "automation-1",
    status: "claimed",
    executionTarget: "local",
    titleSnapshot: "Daily Check",
    promptSnapshot: "Check the repo.",
    gitProviderSnapshot: "github",
    gitOwnerSnapshot: "proliferate-ai",
    gitRepoNameSnapshot: "proliferate",
    agentKindSnapshot: "codex",
    modelIdSnapshot: null,
    modeIdSnapshot: null,
    reasoningEffortSnapshot: null,
    claimId: "claim-1",
    claimExpiresAt: "2026-04-20T00:05:00Z",
    anyharnessWorkspaceId: "workspace-1",
    anyharnessSessionId: null,
    ...overrides,
  };
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-1",
    kind: "worktree",
    path: "/repo/.worktrees/automation",
    repoRootId: "repo-1",
    displayName: null,
    currentBranch: "automation/daily-check-fd253849c4fe4ec9",
    originalBranch: "main",
    surface: "standard",
    lifecycleState: "active",
    cleanupState: "none",
    origin: null,
    executionSummary: null,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

function candidate(): LocalAutomationRepoCandidate {
  return {
    repoRoot: {
      id: "repo-1",
      kind: "external",
      path: "/repo",
      displayName: null,
      remoteProvider: "github",
      remoteOwner: "proliferate-ai",
      remoteRepoName: "proliferate",
      remoteUrl: null,
      defaultBranch: "main",
      createdAt: "2026-04-20T00:00:00Z",
      updatedAt: "2026-04-20T00:00:00Z",
    },
    representativeWorkspace: workspace(),
    identity: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
    },
  };
}

function plan(): LocalAutomationWorktreePlan {
  return {
    repoRootId: "repo-1",
    branchName: "automation/daily-check-fd253849c4fe4ec9",
    workspaceName: "automation-daily-check-fd253849c4fe4ec9",
    displayName: "Daily Check",
    targetPath: "/repo/.worktrees/automation",
    baseRef: "main",
    setupScript: null,
  };
}

function successfulTransitions(overrides: Partial<Parameters<typeof executeLocalAutomationRun>[0]["transitions"]> = {}) {
  return {
    markCreatingWorkspace: vi.fn().mockResolvedValue(accepted()),
    attachWorkspace: vi.fn().mockResolvedValue(accepted()),
    markProvisioningWorkspace: vi.fn().mockResolvedValue(accepted()),
    markCreatingSession: vi.fn().mockResolvedValue(accepted()),
    attachSession: vi.fn().mockResolvedValue(accepted()),
    markDispatching: vi.fn().mockResolvedValue(accepted()),
    markDispatched: vi.fn().mockResolvedValue(accepted()),
    ...overrides,
  };
}

function successfulSessions() {
  return {
    create: vi.fn().mockResolvedValue({
      id: "session-1",
      workspaceId: "workspace-1",
      agentKind: "codex",
    }),
    promptText: vi.fn().mockResolvedValue(undefined),
  };
}

describe("executeLocalAutomationRun", () => {
  it("does not fail a run when the final dispatched write fails after prompt acceptance", async () => {
    const promptText = vi.fn().mockResolvedValue(undefined);
    const client = {
      workspaces: {
        get: vi.fn().mockResolvedValue(workspace()),
        updateDisplayName: vi.fn().mockResolvedValue(workspace({ displayName: "Daily Check" })),
        getSessionLaunchCatalog: vi.fn().mockResolvedValue({
          workspaceId: "workspace-1",
          catalogVersion: "test",
          agents: [{ kind: "codex", models: [] }],
        }),
      },
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: "session-1",
          workspaceId: "workspace-1",
          agentKind: "codex",
        }),
        promptText,
      },
    } as unknown as AnyHarnessClient;
    const markDispatched = vi.fn().mockRejectedValue(new Error("control plane unavailable"));

    await expect(executeLocalAutomationRun({
      client,
      claim: claim(),
      candidate: candidate(),
      plan: plan(),
      transitions: {
        markCreatingWorkspace: vi.fn(),
        attachWorkspace: vi.fn(),
        markProvisioningWorkspace: vi.fn().mockResolvedValue(accepted()),
        markCreatingSession: vi.fn().mockResolvedValue(accepted()),
        attachSession: vi.fn().mockResolvedValue(accepted()),
        markDispatching: vi.fn().mockResolvedValue(accepted()),
        markDispatched,
      },
    })).resolves.toBeUndefined();

    expect(promptText).toHaveBeenCalledWith("session-1", "Check the repo.");
    expect(markDispatched).toHaveBeenCalledWith("workspace-1", "session-1");
  });

  it("sets the friendly display name when creating a workspace", async () => {
    const updateDisplayName = vi.fn().mockResolvedValue(workspace({ displayName: "Daily Check" }));
    const client = {
      workspaces: {
        createWorktree: vi.fn().mockResolvedValue({ workspace: workspace() }),
        updateDisplayName,
        getSessionLaunchCatalog: vi.fn().mockResolvedValue({
          workspaceId: "workspace-1",
          catalogVersion: "test",
          agents: [{ kind: "codex", models: [] }],
        }),
      },
      sessions: successfulSessions(),
    } as unknown as AnyHarnessClient;

    await executeLocalAutomationRun({
      client,
      claim: claim({ anyharnessWorkspaceId: null }),
      candidate: candidate(),
      plan: plan(),
      transitions: successfulTransitions(),
    });

    expect(updateDisplayName).toHaveBeenCalledWith("workspace-1", {
      displayName: "Daily Check",
    });
    expect(client.workspaces.createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorContext: {
          kind: "automation",
          automationId: "automation-1",
          automationRunId: "fd253849-c4fe-4ec9-ade6-9dde6533bb64",
          label: "Daily Check",
        },
      }),
    );
  });

  it("updates blank and old automation display names when reusing a workspace", async () => {
    for (const displayName of [null, "automation-daily-check-fd253849c4fe4ec9"]) {
      const updateDisplayName = vi.fn().mockResolvedValue(workspace({ displayName: "Daily Check" }));
      const client = {
        workspaces: {
          resolveFromPath: vi.fn().mockResolvedValue({ workspace: workspace({ displayName }) }),
          updateDisplayName,
          getSessionLaunchCatalog: vi.fn().mockResolvedValue({
            workspaceId: "workspace-1",
            catalogVersion: "test",
            agents: [{ kind: "codex", models: [] }],
          }),
        },
        sessions: successfulSessions(),
      } as unknown as AnyHarnessClient;

      await executeLocalAutomationRun({
        client,
        claim: claim({ anyharnessWorkspaceId: null }),
        candidate: candidate(),
        plan: plan(),
        transitions: successfulTransitions(),
      });

      expect(updateDisplayName).toHaveBeenCalledWith("workspace-1", {
        displayName: "Daily Check",
      });
    }
  });

  it("does not overwrite a manual display name when reusing a workspace", async () => {
    const updateDisplayName = vi.fn().mockResolvedValue(workspace({ displayName: "Daily Check" }));
    const client = {
      workspaces: {
        resolveFromPath: vi.fn().mockResolvedValue({
          workspace: workspace({ displayName: "My manual rename" }),
        }),
        updateDisplayName,
        getSessionLaunchCatalog: vi.fn().mockResolvedValue({
          workspaceId: "workspace-1",
          catalogVersion: "test",
          agents: [{ kind: "codex", models: [] }],
        }),
      },
      sessions: successfulSessions(),
    } as unknown as AnyHarnessClient;

    await executeLocalAutomationRun({
      client,
      claim: claim({ anyharnessWorkspaceId: null }),
      candidate: candidate(),
      plan: plan(),
      transitions: successfulTransitions(),
    });

    expect(updateDisplayName).not.toHaveBeenCalled();
  });
});
