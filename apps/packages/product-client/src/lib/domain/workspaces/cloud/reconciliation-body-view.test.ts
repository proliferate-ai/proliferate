import { describe, expect, it } from "vitest";
import { buildReconciliationBodyView } from "#product/lib/domain/workspaces/cloud/reconciliation-body-view";
import { resolveWorkspaceGitReconciliation } from "#product/lib/domain/workspaces/cloud/workspace-git-reconciliation";
import type { WorkspaceGitSide } from "#product/lib/domain/workspaces/cloud/workspace-git-relation";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

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

describe("buildReconciliationBodyView", () => {
  it("renders This Mac / Cloud / GitHub columns with abbreviated heads", () => {
    const view = buildReconciliationBodyView({
      plan: resolveWorkspaceGitReconciliation({ kind: "local_ahead", localHead: HEAD_A, remoteHead: null, commits: 2 }),
      local: side({ ahead: 2, headSha: HEAD_A }),
      cloud: side({ headSha: HEAD_B }),
    });
    expect(view.columns.map((c) => c.title)).toEqual(["This Mac", "Cloud", "GitHub branch"]);
    expect(view.columns[0]!.headShort).toBe(HEAD_A.slice(0, 7));
    expect(view.columns[0]!.stateLabel).toBe("2 ahead");
  });

  it("labels the GitHub remote HEAD as last-known with a truthful staleness caveat (never fabricated)", () => {
    const view = buildReconciliationBodyView({
      plan: resolveWorkspaceGitReconciliation({ kind: "same_head", headSha: HEAD_A }),
      local: side(),
      cloud: side(),
    });
    const github = view.columns[2]!;
    expect(github.stateLabel).toBe("last-known");
    expect(github.headShort).toBeNull();
    expect(github.caveat).toMatch(/isn't checked here|verified when the action runs/i);
  });

  it("carries the plan's action detail and cancel-preserves line", () => {
    const plan = resolveWorkspaceGitReconciliation({ kind: "missing", target: "local" });
    const view = buildReconciliationBodyView({ plan, local: side({ presence: "missing" }), cloud: side() });
    expect(view.actionDetail).toBe(plan.action.detail);
    expect(view.cancelPreserves).toBe(plan.cancelPreserves);
  });
});
