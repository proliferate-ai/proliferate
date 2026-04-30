import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { LocalAutomationRunClaimResponse } from "@/lib/integrations/cloud/client";
import {
  buildLocalAutomationRepoCandidates,
  buildLocalAutomationWorktreePlan,
  findCandidateForClaim,
  safeAutomationSlug,
  workspaceMatchesAutomationPlan,
} from "./local-executor";

function repoRoot(overrides: Partial<RepoRoot> = {}): RepoRoot {
  return {
    id: "repo-1",
    kind: "external",
    path: "/repo",
    displayName: null,
    remoteProvider: "github",
    remoteOwner: "Proliferate-AI",
    remoteRepoName: "Proliferate",
    remoteUrl: null,
    defaultBranch: "main",
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-1",
    kind: "local",
    path: "/repo",
    repoRootId: "repo-1",
    displayName: null,
    currentBranch: "main",
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
    anyharnessWorkspaceId: null,
    anyharnessSessionId: null,
    ...overrides,
  };
}

describe("local automation executor domain helpers", () => {
  it("dedupes matching repo roots by stable repo root id", () => {
    const candidates = buildLocalAutomationRepoCandidates({
      repoRoots: [
        repoRoot({ id: "repo-b", path: "/b" }),
        repoRoot({ id: "repo-a", path: "/a" }),
      ],
      workspaces: [
        workspace({ id: "workspace-b", repoRootId: "repo-b", path: "/b" }),
        workspace({ id: "workspace-a", repoRootId: "repo-a", path: "/a" }),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.repoRoot.id).toBe("repo-a");
  });

  it("builds deterministic automation branch names without user branch prefixes", () => {
    const candidates = buildLocalAutomationRepoCandidates({
      repoRoots: [repoRoot()],
      workspaces: [workspace()],
    });
    const plan = buildLocalAutomationWorktreePlan({
      claim: claim(),
      candidate: candidates[0]!,
      homeDir: "/Users/pablo",
      defaultBranch: "main",
      setupScript: "pnpm install",
    });

    expect(plan.branchName).toBe("automation/daily-check-fd253849c4fe4ec9");
    expect(plan.workspaceName).toBe("automation-daily-check-fd253849c4fe4ec9");
    expect(plan.setupScript).toBe("pnpm install");
  });

  it("removes repeated dots from automation branch slugs", () => {
    expect(safeAutomationSlug("foo..bar...baz", "run")).toBe("foo.bar.baz");
    expect(buildLocalAutomationWorktreePlan({
      claim: claim({ titleSnapshot: "foo..bar" }),
      candidate: buildLocalAutomationRepoCandidates({
        repoRoots: [repoRoot()],
        workspaces: [workspace()],
      })[0]!,
      homeDir: "/Users/pablo",
    }).branchName).toBe("automation/foo.bar-fd253849c4fe4ec9");
  });

  it("matches an attached workspace by repo identity and branch", () => {
    const candidates = buildLocalAutomationRepoCandidates({
      repoRoots: [repoRoot()],
      workspaces: [workspace()],
    });
    const currentClaim = claim();
    const plan = buildLocalAutomationWorktreePlan({
      claim: currentClaim,
      candidate: candidates[0]!,
      homeDir: "/Users/pablo",
    });

    expect(findCandidateForClaim(candidates, currentClaim)).toBe(candidates[0]);
    expect(workspaceMatchesAutomationPlan({
      workspace: workspace({
        kind: "worktree",
        currentBranch: plan.branchName,
      }),
      repoRoot: candidates[0]!.repoRoot,
      plan,
      claim: currentClaim,
    })).toBe(true);
  });
});
