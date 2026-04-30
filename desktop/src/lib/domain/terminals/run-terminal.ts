export const RUN_TERMINAL_TITLE = "Run";

export interface RunTerminalCandidate {
  id: string;
  workspaceId: string;
  title: string;
  status: string;
}

export function findReusableRunTerminalId(
  tabs: Iterable<RunTerminalCandidate>,
  workspaceId: string,
): string | null {
  for (const tab of tabs) {
    if (
      tab.workspaceId === workspaceId
      && tab.title === RUN_TERMINAL_TITLE
      && (tab.status === "running" || tab.status === "starting")
    ) {
      return tab.id;
    }
  }
  return null;
}
