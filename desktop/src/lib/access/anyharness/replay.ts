import type {
  AnyHarnessRequestOptions,
  CreateReplaySessionRequest,
} from "@anyharness/sdk";
import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

export function getReplayRuntimeHealth(
  connection: AnyHarnessClientConnection,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).runtime.getHealth(options);
}

export function listReplayRecordings(
  connection: AnyHarnessClientConnection,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).replay.listRecordings(options);
}

export function createReplaySession(
  connection: AnyHarnessClientConnection,
  request: CreateReplaySessionRequest,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).replay.createSession(request, options);
}

export function advanceReplaySession(
  connection: AnyHarnessClientConnection,
  sessionId: string,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).replay.advanceSession(sessionId, options);
}
