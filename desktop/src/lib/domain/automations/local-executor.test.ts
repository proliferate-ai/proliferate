import { describe, expect, it } from "vitest";
import type {
  AutomationRepoRootRecord,
  AutomationRunClaimRecord,
  AutomationWorkspaceRecord,
} from "./local-executor-records";
import {
  buildLocalAutomationRepoCandidates,
  buildLocalAutomationWorktreePlan,
  findCandidateForClaim,
  normalizeAutomationWorkspaceDisplayName,
  safeAutomationSlug,
  workspaceMatchesAutomationPlan,
} from "./local-executor";

function repoRoot(overrides: Partial<AutomationRepoRootRecord> = {}): AutomationRepoRootRecord {
  return {
    id: "repo-1",
    path: "/repo",
    remoteProvider: "github",
    remoteOwner: "Proliferate-AI",
    remoteRepoName: "Proliferate",
    defaultBranch: "main",
    ...overrides,
  };
}

function workspace(
  overrides: Partial<AutomationWorkspaceRecord> = {},
): AutomationWorkspaceRecord {
  return {
    id: "workspace-1",
    kind: "local",
    path: "/repo",
    repoRootId: "repo-1",
    displayName: null,
    currentBranch: "main",
    originalBranch: "main",
    ...overrides,
  };
}

function claim(overrides: Partial<AutomationRunClaimRecord> = {}): AutomationRunClaimRecord {
  return {
    id: "fd253849-c4fe-4ec9-ade6-9dde6533bb64",
    titleSnapshot: "Daily Check",
    gitProviderSnapshot: "github",
    gitOwnerSnapshot: "proliferate-ai",
    gitRepoNameSnapshot: "proliferate",
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
    expect(plan.displayName).toBe("Daily Check");
    expect(plan.setupScript).toBe("pnpm install");
  });

  it("normalizes friendly automation workspace display names safely", () => {
    expect(normalizeAutomationWorkspaceDisplayName("  Daily   repo\ncheck  ")).toBe(
      "Daily repo check",
    );
    expect(normalizeAutomationWorkspaceDisplayName("   ")).toBe("Automation run");
    expect(normalizeAutomationWorkspaceDisplayName("x".repeat(200))).toHaveLength(160);
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
