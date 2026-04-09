export type TerminalStatus = "starting" | "running" | "exited" | "failed";

export interface TerminalRecord {
  id: string;
  workspaceId: string;
  title: string;
  cwd: string;
  status: TerminalStatus;
  exitCode?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTerminalRequest {
  cwd?: string;
  shell?: string;
  cols: number;
  rows: number;
}

export interface ResizeTerminalRequest {
  cols: number;
  rows: number;
}
