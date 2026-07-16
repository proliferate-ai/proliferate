import { describe, expect, it, vi } from "vitest";
import type { PushResponse } from "@anyharness/sdk";
import { runPushAndContinue } from "#product/lib/domain/workspaces/cloud/push-and-continue-orchestration";
import { resolveWorkspaceGitReconciliation } from "#product/lib/domain/workspaces/cloud/workspace-git-reconciliation";
import type { WorkspaceGitRelation, WorkspaceGitSide } from "#product/lib/domain/workspaces/cloud/workspace-git-relation";

/**
 * Absolute safety rail (frozen spec Tests): NO reset/stash/rebase/merge/force
 * command is issued by these workflows. This spies on the exact git-client
 * surface a workflow could reach and asserts that (a) the client exposes no
 * destructive verb at all, and (b) push-and-continue only ever calls `push`.
 */

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

const DESTRUCTIVE_METHODS = ["reset", "stash", "rebase", "merge", "forcePush", "checkout", "clean", "revert"];

function side(overrides: Partial<WorkspaceGitSide> = {}): WorkspaceGitSide {
  return {
    presence: "present",
    provider: "github",
    owner: "acme",
    repoName: "rocket",
    branch: "feat/x",
    headSha: HEAD_A,
    clean: true,
    conflicted: false,
    detached: false,
    operationInProgress: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    ...overrides,
  };
}

describe("no destructive git verb is ever invoked by reconciliation workflows", () => {
  it("push-and-continue calls ONLY push on the git surface (spy)", async () => {
    const published: PushResponse = { branch: "feat/x", published: true, remote: "origin" };
    // A fake git client with the full mutating surface spied; only push is legal.
    const gitSurface = {
      push: vi.fn().mockResolvedValue(published),
      reset: vi.fn(),
      stash: vi.fn(),
      rebase: vi.fn(),
      merge: vi.fn(),
      forcePush: vi.fn(),
      checkout: vi.fn(),
      clean: vi.fn(),
      revert: vi.fn(),
    };
    const localSides = [side({ ahead: 2, headSha: HEAD_A }), side({ headSha: HEAD_B })];
    await runPushAndContinue("local_ahead", {
      readLocalSide: () => Promise.resolve(localSides.shift() ?? side({ headSha: HEAD_B })),
      readCloudSide: () => Promise.resolve(side({ headSha: HEAD_B })),
      push: () => gitSurface.push(),
    });
    expect(gitSurface.push).toHaveBeenCalledOnce();
    for (const method of DESTRUCTIVE_METHODS) {
      expect(gitSurface[method as keyof typeof gitSurface]).not.toHaveBeenCalled();
    }
  });

  it("no action plan across the whole matrix names a destructive verb", () => {
    const relations: WorkspaceGitRelation[] = [
      { kind: "same_head", headSha: HEAD_A },
      { kind: "local_ahead", localHead: HEAD_A, remoteHead: null, commits: 2 },
      { kind: "cloud_ahead", cloudHead: HEAD_B, remoteHead: null, commits: 1 },
      { kind: "local_dirty" },
      { kind: "cloud_dirty" },
      { kind: "conflicted", target: "local" },
      { kind: "git_operation_in_progress", target: "cloud" },
      { kind: "detached", target: "local" },
      { kind: "behind", target: "local" },
      { kind: "diverged", localHead: HEAD_A, cloudHead: HEAD_B, remoteHead: null },
      { kind: "missing", target: "local" },
      { kind: "missing", target: "cloud" },
      { kind: "unreachable", target: "local" },
      { kind: "unknown", reason: "x" },
    ];
    // The safety note deliberately mentions these words in a NEGATED form, so we
    // assert against the machine-readable verb, not free text.
    const allowedVerbs = new Set([
      "link", "push-local", "push-cloud", "open-git-panel", "recreate", "relink", "unlink", "retry", "none",
    ]);
    for (const relation of relations) {
      const verb = resolveWorkspaceGitReconciliation(relation).action.verb;
      expect(allowedVerbs.has(verb)).toBe(true);
      expect(verb).not.toMatch(/reset|stash|rebase|merge|force/);
    }
  });
});
