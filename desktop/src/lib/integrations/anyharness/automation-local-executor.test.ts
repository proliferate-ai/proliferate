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

function claim(): LocalAutomationRunClaimResponse {
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
  };
}

function workspace(): Workspace {
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
    targetPath: "/repo/.worktrees/automation",
    baseRef: "main",
    setupScript: null,
  };
}

describe("executeLocalAutomationRun", () => {
  it("does not fail a run when the final dispatched write fails after prompt acceptance", async () => {
    const promptText = vi.fn().mockResolvedValue(undefined);
    const client = {
      workspaces: {
        get: vi.fn().mockResolvedValue(workspace()),
        getSessionLaunchCatalog: vi.fn().mockResolvedValue({
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
});
