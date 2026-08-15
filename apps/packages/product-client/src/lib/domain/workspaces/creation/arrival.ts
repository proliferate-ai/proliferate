import type { SetupScriptExecution } from "@anyharness/sdk";

export interface WorkspaceArrivalEvent {
  workspaceId: string;
  source: "local-created" | "worktree-created" | "cloud-created" | "cowork-created";
  /**
   * Stable ProductClient alias for the session created with this workspace.
   * The arrival itself is workspace-scoped; only the synthetic transcript
   * receipt uses this owner to bridge the pre-materialization query gap.
   */
  receiptClientSessionId: string | null;
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
  receiptClientSessionId?: string | null;
  setupScript?: SetupScriptExecution | null;
  baseBranchName?: string | null;
}): WorkspaceArrivalEvent {
  return {
    workspaceId: input.workspaceId,
    source: input.source,
    receiptClientSessionId: input.receiptClientSessionId ?? null,
    setupScript: input.setupScript ?? null,
    baseBranchName: input.baseBranchName ?? null,
    createdAt: Date.now(),
  };
}
