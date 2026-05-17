import type {
  CreateSessionRequest,
  PromptSessionRequest,
  ResolveInteractionRequest,
  SetSessionConfigOptionRequest,
  UpdateSessionTitleRequest,
} from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import { retryAfterRuntimeConfigResolution } from "@/lib/workflows/mcp/runtime-config-resolution";

type SessionConnection = AnyHarnessClientConnection | AnyHarnessResolvedConnection;
type AnyHarnessClient = ReturnType<typeof getAnyHarnessClient>;
export type AnyHarnessSessionConnection = SessionConnection;
export type AnyHarnessWorkspaceSessionConnection = AnyHarnessResolvedConnection;
export type ListSessionsOptions = Parameters<AnyHarnessClient["sessions"]["list"]>[1];
export type ListSessionEventsOptions =
  Parameters<AnyHarnessClient["sessions"]["listEvents"]>[1];
type RestoreDismissedSessionOptions =
  Parameters<AnyHarnessClient["sessions"]["restoreDismissed"]>[1];
type UpdateSessionTitleOptions =
  Parameters<AnyHarnessClient["sessions"]["updateTitle"]>[2];
type GetSessionOptions = Parameters<AnyHarnessClient["sessions"]["get"]>[1];
type PromptSessionOptions = Parameters<AnyHarnessClient["sessions"]["prompt"]>[2];
type CreateSessionOptions = Parameters<AnyHarnessClient["sessions"]["create"]>[1];
type ResumeSessionRequest = Parameters<AnyHarnessClient["sessions"]["resume"]>[1];
type ResumeSessionOptions = Parameters<AnyHarnessClient["sessions"]["resume"]>[2];
type GetSubagentsOptions = Parameters<AnyHarnessClient["sessions"]["getSubagents"]>[1];

export function listWorkspaceSessions(
  connection: AnyHarnessResolvedConnection,
  options?: ListSessionsOptions,
) {
  return getAnyHarnessClient(connection).sessions.list(
    connection.anyharnessWorkspaceId,
    options,
  );
}

export function createSession(
  connection: SessionConnection,
  request: CreateSessionRequest,
  options?: CreateSessionOptions,
) {
  return retryAfterRuntimeConfigResolution(connection, () =>
    getAnyHarnessClient(connection).sessions.create(request, options)
  );
}

export function getSession(
  connection: SessionConnection,
  sessionId: string,
  options?: GetSessionOptions,
) {
  return getAnyHarnessClient(connection).sessions.get(sessionId, options);
}

export function listSessionEvents(
  connection: SessionConnection,
  sessionId: string,
  options?: ListSessionEventsOptions,
) {
  return getAnyHarnessClient(connection).sessions.listEvents(sessionId, options);
}

export function fetchPromptAttachment(
  connection: SessionConnection,
  sessionId: string,
  attachmentId: string,
) {
  return getAnyHarnessClient(connection).sessions.fetchPromptAttachment(
    sessionId,
    attachmentId,
  );
}

export function promptSession(
  connection: SessionConnection,
  sessionId: string,
  request: PromptSessionRequest,
  options?: PromptSessionOptions,
) {
  return retryAfterRuntimeConfigResolution(connection, () =>
    getAnyHarnessClient(connection).sessions.prompt(sessionId, request, options)
  );
}

export function resumeSession(
  connection: SessionConnection,
  sessionId: string,
  request: ResumeSessionRequest,
  options?: ResumeSessionOptions,
) {
  return retryAfterRuntimeConfigResolution(connection, () =>
    getAnyHarnessClient(connection).sessions.resume(sessionId, request, options)
  );
}

export function setSessionConfigOption(
  connection: SessionConnection,
  sessionId: string,
  request: SetSessionConfigOptionRequest,
) {
  return getAnyHarnessClient(connection).sessions.setConfigOption(sessionId, request);
}

export function cancelSession(connection: SessionConnection, sessionId: string) {
  return getAnyHarnessClient(connection).sessions.cancel(sessionId);
}

export function dismissSession(connection: SessionConnection, sessionId: string) {
  return getAnyHarnessClient(connection).sessions.dismiss(sessionId);
}

export function closeSession(connection: SessionConnection, sessionId: string) {
  return getAnyHarnessClient(connection).sessions.close(sessionId);
}

export function restoreDismissedSession(
  connection: AnyHarnessResolvedConnection,
  options?: RestoreDismissedSessionOptions,
) {
  return getAnyHarnessClient(connection).sessions.restoreDismissed(
    connection.anyharnessWorkspaceId,
    options,
  );
}

export function updateSessionTitle(
  connection: SessionConnection,
  sessionId: string,
  request: UpdateSessionTitleRequest,
  options?: UpdateSessionTitleOptions,
) {
  return getAnyHarnessClient(connection).sessions.updateTitle(sessionId, request, options);
}

export function resolveSessionInteraction(
  connection: SessionConnection,
  sessionId: string,
  requestId: string,
  request: ResolveInteractionRequest,
) {
  return getAnyHarnessClient(connection).sessions.resolveInteraction(
    sessionId,
    requestId,
    request,
  );
}

export function revealMcpElicitationUrl(
  connection: SessionConnection,
  sessionId: string,
  requestId: string,
) {
  return getAnyHarnessClient(connection).sessions.revealMcpElicitationUrl(
    sessionId,
    requestId,
  );
}

export function getSessionSubagents(
  connection: SessionConnection,
  sessionId: string,
  options?: GetSubagentsOptions,
) {
  return getAnyHarnessClient(connection).sessions.getSubagents(sessionId, options);
}
