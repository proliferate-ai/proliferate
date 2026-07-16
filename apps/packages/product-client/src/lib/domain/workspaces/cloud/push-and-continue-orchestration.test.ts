import { describe, expect, it, vi } from "vitest";
import type { PushResponse } from "@anyharness/sdk";
import { runPushAndContinue } from "#product/lib/domain/workspaces/cloud/push-and-continue-orchestration";
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

const published: PushResponse = { branch: "feat/x", published: true, remote: "origin" };
const notPublished: PushResponse = { branch: "feat/x", published: false, remote: "origin" };

describe("runPushAndContinue", () => {
  it("pushes a clean local_ahead then continues on same_head after re-read", async () => {
    const push = vi.fn().mockResolvedValue(published);
    // Preflight: local ahead. Post-push: converged.
    const localSides = [side({ ahead: 2, headSha: HEAD_A }), side({ headSha: HEAD_B })];
    const readLocalSide = vi.fn().mockImplementation(() => Promise.resolve(localSides.shift()!));
    const readCloudSide = vi.fn().mockResolvedValue(side({ headSha: HEAD_B }));
    const outcome = await runPushAndContinue("local_ahead", { readLocalSide, readCloudSide, push });
    expect(push).toHaveBeenCalledOnce();
    expect(outcome.status).toBe("continued");
  });

  it("cancels the stale action when the relation changed between preflight and push", async () => {
    const push = vi.fn().mockResolvedValue(published);
    // Preflight now reads DIRTY (someone edited): the confirmed local_ahead is stale.
    const readLocalSide = vi.fn().mockResolvedValue(side({ clean: false }));
    const readCloudSide = vi.fn().mockResolvedValue(side({ headSha: HEAD_B }));
    const outcome = await runPushAndContinue("local_ahead", { readLocalSide, readCloudSide, push });
    expect(push).not.toHaveBeenCalled();
    expect(outcome.status).toBe("cancelled_stale");
  });

  it("does not treat an unpublished push as success (published is the signal)", async () => {
    const push = vi.fn().mockResolvedValue(notPublished);
    const readLocalSide = vi.fn().mockResolvedValue(side({ ahead: 1, headSha: HEAD_A }));
    const readCloudSide = vi.fn().mockResolvedValue(side({ headSha: HEAD_B }));
    const outcome = await runPushAndContinue("local_ahead", { readLocalSide, readCloudSide, push });
    expect(outcome.status).toBe("not_published");
  });

  it("reports still_ahead when a published push did not converge", async () => {
    const push = vi.fn().mockResolvedValue(published);
    const readLocalSide = vi.fn().mockResolvedValue(side({ ahead: 1, headSha: HEAD_A }));
    const readCloudSide = vi.fn().mockResolvedValue(side({ headSha: HEAD_B }));
    const outcome = await runPushAndContinue("local_ahead", { readLocalSide, readCloudSide, push });
    expect(outcome.status).toBe("still_ahead");
  });

  it("continues immediately if a concurrent push already converged the sides", async () => {
    const push = vi.fn().mockResolvedValue(published);
    const readLocalSide = vi.fn().mockResolvedValue(side({ headSha: HEAD_A }));
    const readCloudSide = vi.fn().mockResolvedValue(side({ headSha: HEAD_A }));
    const outcome = await runPushAndContinue("local_ahead", { readLocalSide, readCloudSide, push });
    expect(push).not.toHaveBeenCalled();
    expect(outcome.status).toBe("continued");
  });
});
