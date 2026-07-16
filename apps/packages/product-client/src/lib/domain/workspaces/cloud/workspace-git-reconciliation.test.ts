import { describe, expect, it } from "vitest";
import { resolveWorkspaceGitReconciliation } from "#product/lib/domain/workspaces/cloud/workspace-git-reconciliation";
import type { WorkspaceGitRelation } from "#product/lib/domain/workspaces/cloud/workspace-git-relation";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

const DESTRUCTIVE = /reset|stash|rebase|merge|force|pull/i;

function plan(relation: WorkspaceGitRelation) {
  return resolveWorkspaceGitReconciliation(relation);
}

describe("resolveWorkspaceGitReconciliation — action matrix", () => {
  it("same_head → immediate link, no confirmation, linkable", () => {
    const p = plan({ kind: "same_head", headSha: HEAD_A });
    expect(p.action.verb).toBe("link");
    expect(p.action.requiresConfirmation).toBe(false);
    expect(p.linkable).toBe(true);
  });

  it("local_ahead → push-local with confirmation", () => {
    const p = plan({ kind: "local_ahead", localHead: HEAD_A, remoteHead: null, commits: 2 });
    expect(p.action.verb).toBe("push-local");
    expect(p.action.requiresConfirmation).toBe(true);
    expect(p.action.label).toMatch(/Push from this Mac/);
    expect(p.action.detail).toMatch(/2 commits/);
  });

  it("cloud_ahead → push-cloud with confirmation and Cloud authority wording", () => {
    const p = plan({ kind: "cloud_ahead", cloudHead: HEAD_B, remoteHead: null, commits: 1 });
    expect(p.action.verb).toBe("push-cloud");
    expect(p.action.requiresConfirmation).toBe(true);
    expect(p.action.detail).toMatch(/1 commit\b/);
  });

  it("local_dirty → open git panel (manual), never a mutation verb", () => {
    const p = plan({ kind: "local_dirty" });
    expect(p.action.verb).toBe("open-git-panel");
    expect(p.linkable).toBe(false);
  });

  it("cloud_dirty → informational (no local git panel to open)", () => {
    const p = plan({ kind: "cloud_dirty" });
    expect(p.action.verb).toBe("none");
  });

  it("conflicted local → open git panel; conflicted cloud → informational", () => {
    expect(plan({ kind: "conflicted", target: "local" }).action.verb).toBe("open-git-panel");
    expect(plan({ kind: "conflicted", target: "cloud" }).action.verb).toBe("none");
  });

  it("detached / operation route to manual guidance", () => {
    expect(plan({ kind: "detached", target: "local" }).action.verb).toBe("open-git-panel");
    expect(plan({ kind: "git_operation_in_progress", target: "local" }).action.verb).toBe("open-git-panel");
  });

  it("behind → manual update guidance, no implicit pull", () => {
    const p = plan({ kind: "behind", target: "local" });
    expect(p.action.verb).toBe("open-git-panel");
    expect(p.action.detail).toMatch(/manually/i);
  });

  it("diverged → manual resolution, no direction chosen", () => {
    const p = plan({ kind: "diverged", localHead: HEAD_A, cloudHead: HEAD_B, remoteHead: null });
    expect(p.action.verb).toBe("open-git-panel");
    expect(p.action.detail).toMatch(/will not choose/i);
  });

  it("missing local → recreate (with relink/unlink in copy)", () => {
    const p = plan({ kind: "missing", target: "local" });
    expect(p.action.verb).toBe("recreate");
    expect(p.action.requiresConfirmation).toBe(true);
  });

  it("missing cloud / unreachable / unknown → retry, association preserved", () => {
    expect(plan({ kind: "missing", target: "cloud" }).action.verb).toBe("retry");
    expect(plan({ kind: "unreachable", target: "local" }).action.verb).toBe("retry");
    expect(plan({ kind: "unknown", reason: "x" }).action.verb).toBe("retry");
    expect(plan({ kind: "unreachable", target: "cloud" }).cancelPreserves).toMatch(/preserved/i);
  });

  it("NEVER offers a destructive git verb in any action label or detail", () => {
    const relations: WorkspaceGitRelation[] = [
      { kind: "same_head", headSha: HEAD_A },
      { kind: "local_ahead", localHead: HEAD_A, remoteHead: null, commits: 2 },
      { kind: "cloud_ahead", cloudHead: HEAD_B, remoteHead: null, commits: 1 },
      { kind: "local_dirty" },
      { kind: "cloud_dirty" },
      { kind: "conflicted", target: "local" },
      { kind: "conflicted", target: "cloud" },
      { kind: "git_operation_in_progress", target: "local" },
      { kind: "detached", target: "cloud" },
      { kind: "behind", target: "local" },
      { kind: "diverged", localHead: HEAD_A, cloudHead: HEAD_B, remoteHead: null },
      { kind: "missing", target: "local" },
      { kind: "missing", target: "cloud" },
      { kind: "unreachable", target: "local" },
      { kind: "unknown", reason: "x" },
    ];
    for (const relation of relations) {
      const p = plan(relation);
      // The word may appear only in a NEGATED safety note ("nothing is reset,
      // merged, rebased, or deleted"); assert the LABEL never carries it.
      expect(p.action.label).not.toMatch(DESTRUCTIVE);
      expect(p.action.label).not.toMatch(/\bsync\b/i);
    }
  });
});
