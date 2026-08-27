import type {
  AgentAuthStateDocument,
  AnyHarnessRequestOptions,
  NativeBridgeResponse,
} from "@anyharness/sdk";
import {
  getAnyHarnessClient,
  type AnyHarnessClientConnection,
} from "@anyharness/sdk-react";

export function applyAgentAuthState(
  connection: AnyHarnessClientConnection,
  state: AgentAuthStateDocument,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).agentAuth.applyState(state, options);
}

export function clearAgentAuthState(
  connection: AnyHarnessClientConnection,
  options?: AnyHarnessRequestOptions,
) {
  return getAnyHarnessClient(connection).agentAuth.clearState(options);
}

/**
 * The native-migration bridge: which harnesses on this machine still carry
 * the legacy flag that keeps launches on the harness's own login until the
 * one-time settings prompt is acted on.
 */
export function getNativeBridge(
  connection: AnyHarnessClientConnection,
  options?: AnyHarnessRequestOptions,
): Promise<NativeBridgeResponse> {
  return getAnyHarnessClient(connection).agentAuth.getNativeBridge(options);
}

/** The prompt's dismiss act: drop one harness's legacy flag. */
export function dismissNativeBridge(
  connection: AnyHarnessClientConnection,
  harnessKind: string,
  options?: AnyHarnessRequestOptions,
): Promise<void> {
  return getAnyHarnessClient(connection).agentAuth.dismissNativeBridge(
    harnessKind,
    options,
  );
}
