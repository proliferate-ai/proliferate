import type { SetupScriptExecution } from "@anyharness/sdk";

export interface WorkspaceArrivalEvent {
  workspaceId: string;
  source: "local-created" | "worktree-created" | "cloud-created" | "cowork-created";
  setupScript?: SetupScriptExecution | null;
  baseBranchName?: string | null;
  createdAt: number;
}

export function summarizeSetupFailure(setup: SetupScriptExecution): string {
  const output = `${setup.stderr}\n${setup.stdout}`.trim();
  const firstLine = output.split("\n").find((line) => line.trim().length > 0);
  if (!firstLine) {
    return `Setup failed with exit code ${setup.exitCode}.`;
  }

  return `Setup failed with exit code ${setup.exitCode}: ${firstLine}`;
}

export function buildWorkspaceArrivalEvent(input: {
  workspaceId: string;
  source: WorkspaceArrivalEvent["source"];
  setupScript?: SetupScriptExecution | null;
  baseBranchName?: string | null;
}): WorkspaceArrivalEvent {
  return {
    workspaceId: input.workspaceId,
    source: input.source,
    setupScript: input.setupScript ?? null,
    baseBranchName: input.baseBranchName ?? null,
    createdAt: Date.now(),
  };
}
