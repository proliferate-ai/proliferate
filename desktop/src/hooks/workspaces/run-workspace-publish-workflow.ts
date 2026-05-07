import type { CommitRequest } from "@anyharness/sdk";
import type { PublishWorkflowStep } from "@/lib/domain/workspaces/creation/publish-workflow";

export interface WorkspacePublishWorkflowRunner {
  stagePaths: (paths: string[]) => Promise<unknown>;
  commit: (input: CommitRequest) => Promise<unknown>;
  push: () => Promise<unknown>;
  createPullRequest: (input: Extract<PublishWorkflowStep, { kind: "create_pull_request" }>["request"]) => Promise<unknown>;
}

export async function runWorkspacePublishWorkflow(
  steps: PublishWorkflowStep[],
  runner: WorkspacePublishWorkflowRunner,
): Promise<void> {
  for (const step of steps) {
    switch (step.kind) {
      case "stage":
        if (step.paths.length > 0) {
          await runner.stagePaths(step.paths);
        }
        break;
      case "commit":
        await runner.commit({ summary: step.summary });
        break;
      case "push":
        await runner.push();
        break;
      case "create_pull_request":
        await runner.createPullRequest(step.request);
        break;
    }
  }
}
