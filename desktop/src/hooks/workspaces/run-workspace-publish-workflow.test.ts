import { describe, expect, it, vi } from "vitest";
import { runWorkspacePublishWorkflow } from "./run-workspace-publish-workflow";

describe("runWorkspacePublishWorkflow", () => {
  it("runs commit-only workflows", async () => {
    const runner = runnerMock();
    await runWorkspacePublishWorkflow([{ kind: "commit", summary: "Update app" }], runner);
    expect(runner.commit).toHaveBeenCalledWith({ summary: "Update app" });
    expect(runner.push).not.toHaveBeenCalled();
  });

  it("runs commit and publish workflows in order", async () => {
    const calls: string[] = [];
    const runner = runnerMock(calls);
    await runWorkspacePublishWorkflow([
      { kind: "stage", paths: ["src/app.ts"] },
      { kind: "commit", summary: "Update app" },
      { kind: "push" },
    ], runner);
    expect(calls).toEqual(["stage", "commit", "push"]);
  });

  it("runs publish-only workflows", async () => {
    const runner = runnerMock();
    await runWorkspacePublishWorkflow([{ kind: "push" }], runner);
    expect(runner.push).toHaveBeenCalledOnce();
    expect(runner.commit).not.toHaveBeenCalled();
  });

  it("creates PR after publish", async () => {
    const calls: string[] = [];
    const runner = runnerMock(calls);
    await runWorkspacePublishWorkflow([
      { kind: "push" },
      {
        kind: "create_pull_request",
        request: { title: "Update app", baseBranch: "main", draft: true },
      },
    ], runner);
    expect(calls).toEqual(["push", "createPullRequest"]);
    expect(runner.createPullRequest).toHaveBeenCalledWith({
      title: "Update app",
      baseBranch: "main",
      draft: true,
    });
  });

  it("creates PR without pushing when the workflow has no push step", async () => {
    const runner = runnerMock();
    await runWorkspacePublishWorkflow([
      {
        kind: "create_pull_request",
        request: { title: "Update app", baseBranch: "main", draft: false },
      },
    ], runner);
    expect(runner.push).not.toHaveBeenCalled();
    expect(runner.createPullRequest).toHaveBeenCalledWith({
      title: "Update app",
      baseBranch: "main",
      draft: false,
    });
  });

  it("stops on push rejection", async () => {
    const runner = runnerMock();
    vi.mocked(runner.push).mockRejectedValueOnce(new Error("rejected"));
    await expect(runWorkspacePublishWorkflow([
      { kind: "push" },
      {
        kind: "create_pull_request",
        request: { title: "Update app", baseBranch: "main", draft: false },
      },
    ], runner)).rejects.toThrow("rejected");
    expect(runner.createPullRequest).not.toHaveBeenCalled();
  });
});

function runnerMock(calls: string[] = []) {
  return {
    stagePaths: vi.fn(async () => calls.push("stage")),
    commit: vi.fn(async () => calls.push("commit")),
    push: vi.fn(async () => calls.push("push")),
    createPullRequest: vi.fn(async () => calls.push("createPullRequest")),
  };
}
