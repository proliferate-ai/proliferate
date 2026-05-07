import type {
  CreateTerminalRequest,
  ResizeTerminalRequest,
  StartTerminalCommandRequest,
  UpdateTerminalTitleRequest,
} from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";

export function listWorkspaceTerminals(connection: AnyHarnessResolvedConnection) {
  return getAnyHarnessClient(connection).terminals.list(connection.anyharnessWorkspaceId);
}

export function createWorkspaceTerminal(
  connection: AnyHarnessResolvedConnection,
  request: CreateTerminalRequest,
) {
  return getAnyHarnessClient(connection).terminals.create(
    connection.anyharnessWorkspaceId,
    request,
  );
}

export function closeTerminal(connection: AnyHarnessResolvedConnection, terminalId: string) {
  return getAnyHarnessClient(connection).terminals.close(terminalId);
}

export function resizeTerminal(
  connection: AnyHarnessResolvedConnection,
  terminalId: string,
  request: ResizeTerminalRequest,
) {
  return getAnyHarnessClient(connection).terminals.resize(terminalId, request);
}

export function updateTerminalTitle(
  connection: AnyHarnessResolvedConnection,
  terminalId: string,
  request: UpdateTerminalTitleRequest,
) {
  return getAnyHarnessClient(connection).terminals.updateTitle(terminalId, request);
}

export function runTerminalCommand(
  connection: AnyHarnessResolvedConnection,
  terminalId: string,
  request: StartTerminalCommandRequest,
) {
  return getAnyHarnessClient(connection).terminals.runCommand(terminalId, request);
}
