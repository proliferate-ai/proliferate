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
  for (const tab of tabs) {
    if (
      tab.workspaceId === workspaceId
      && tab.purpose === "run"
      && (tab.status === "running" || tab.status === "starting")
    ) {
      return tab.id;
    }
  }
  return null;
}
