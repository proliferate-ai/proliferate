import type { CreateTerminalRequest, TerminalRecord } from "@anyharness/sdk";
import {
  findReusableRunTerminalId,
  RUN_TERMINAL_TITLE,
} from "@/lib/domain/terminals/run-terminal";

export type CloseTerminalResult = "closed" | "missing" | "blocked" | "failed";

export interface CreateRunTerminalTabInput {
  workspaceId: string;
  command: string;
  cols?: number;
  rows?: number;
}

export interface CreateRunTerminalTabDeps<Connection> {
  getWorkspaceRuntimeBlockReason(workspaceId: string): string | null;
  resolveWorkspaceConnection(workspaceId: string): Promise<Connection>;
  listWorkspaceTerminals(connection: Connection): Promise<TerminalRecord[]>;
  setWorkspaceTerminalRecords(workspaceId: string, records: TerminalRecord[]): void;
  createWorkspaceTerminal(
    connection: Connection,
    request: CreateTerminalRequest,
  ): Promise<TerminalRecord>;
  invalidateWorkspaceTerminals(workspaceId: string): Promise<unknown>;
}

export async function createRunTerminalTabWorkflow<Connection>(
  input: CreateRunTerminalTabInput,
  deps: CreateRunTerminalTabDeps<Connection>,
): Promise<string> {
  const blockedReason = deps.getWorkspaceRuntimeBlockReason(input.workspaceId);
  if (blockedReason) {
    throw new Error(blockedReason);
  }

  const connection = await deps.resolveWorkspaceConnection(input.workspaceId);
  let records: TerminalRecord[] = [];
  try {
    records = await deps.listWorkspaceTerminals(connection);
    deps.setWorkspaceTerminalRecords(input.workspaceId, records);
  } catch {
    // Listing is only for Run tab reuse. Preserve the create path if it fails.
  }

  const existingRunTabId = findReusableRunTerminalId(
    records.map((record) => ({ ...record, workspaceId: input.workspaceId })),
    input.workspaceId,
  );
  if (existingRunTabId) {
    return existingRunTabId;
  }

  const record = await deps.createWorkspaceTerminal(connection, {
    cols: input.cols ?? 120,
    rows: input.rows ?? 40,
    title: RUN_TERMINAL_TITLE,
    purpose: "run",
    startupCommand: input.command,
  });
  await deps.invalidateWorkspaceTerminals(input.workspaceId);
  return record.id;
}

export interface CloseTerminalTabInput {
  terminalId: string;
  workspaceId: string;
}

export interface CloseTerminalTabDeps<Connection> {
  getWorkspaceRuntimeBlockReason(workspaceId: string): string | null;
  showToast(message: string): void;
  markTerminalIntentionalClose(terminalId: string): void;
  clearTerminalIntentionalClose(terminalId: string): void;
  resolveWorkspaceConnection(workspaceId: string): Promise<Connection>;
  closeTerminal(connection: Connection, terminalId: string): Promise<unknown>;
  clearClosedTerminalState(terminalId: string, workspaceId: string): void;
  isMissingTerminalError(error: unknown): boolean;
  invalidateWorkspaceTerminals(workspaceId: string): Promise<unknown>;
}

export async function closeTerminalTabWorkflow<Connection>(
  input: CloseTerminalTabInput,
  deps: CloseTerminalTabDeps<Connection>,
): Promise<CloseTerminalResult> {
  const blockedReason = deps.getWorkspaceRuntimeBlockReason(input.workspaceId);
  if (blockedReason) {
    deps.showToast(blockedReason);
    return "blocked";
  }

  deps.markTerminalIntentionalClose(input.terminalId);

  try {
    const connection = await deps.resolveWorkspaceConnection(input.workspaceId);
    await deps.closeTerminal(connection, input.terminalId);
    deps.clearClosedTerminalState(input.terminalId, input.workspaceId);
    return "closed";
  } catch (error) {
    if (deps.isMissingTerminalError(error)) {
      deps.clearClosedTerminalState(input.terminalId, input.workspaceId);
      return "missing";
    }
    return "failed";
  } finally {
    deps.clearTerminalIntentionalClose(input.terminalId);
    await deps.invalidateWorkspaceTerminals(input.workspaceId);
  }
}
