export const RUN_TERMINAL_TITLE = "Run command";

export interface RunTerminalCandidate {
  id: string;
  workspaceId: string;
  title: string;
  purpose?: string | null;
  status: string;
}

export function findReusableRunTerminalId(
  tabs: Iterable<RunTerminalCandidate>,
  workspaceId: string,
): string | null {
  return findLiveTerminalId(tabs, workspaceId, "run");
}

/**
 * Live setup-script terminal. The header Run action falls back to revealing
 * it when the workspace has no run command configured.
 */
export function findLiveSetupTerminalId(
  tabs: Iterable<RunTerminalCandidate>,
  workspaceId: string,
): string | null {
  return findLiveTerminalId(tabs, workspaceId, "setup");
}

function findLiveTerminalId(
  tabs: Iterable<RunTerminalCandidate>,
  workspaceId: string,
  purpose: "run" | "setup",
): string | null {
  for (const tab of tabs) {
    if (
      tab.workspaceId === workspaceId
      && tab.purpose === purpose
      && (tab.status === "running" || tab.status === "starting")
    ) {
      return tab.id;
    }
  }
  return null;
}
