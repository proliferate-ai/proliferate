import type {
  AgentAuthMethodRow,
  AgentAuthStateDocument,
  AgentAuthStatusDoc,
  AnyHarnessRequestOptions,
  NativeBridgeResponse,
} from "@anyharness/sdk";
import { streamAgentAuthStatus } from "@anyharness/sdk";
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
 * One harness's status document, or `null` when the runtime holds no row for a
 * known harness kind (`GET /status?harness=` answers `[]`). An UNKNOWN harness
 * kind is a 404 and stays an error — the two are different facts.
 */
export async function getHarnessAuthStatus(
  connection: AnyHarnessClientConnection,
  harnessKind: string,
  options?: AnyHarnessRequestOptions,
): Promise<AgentAuthStatusDoc | null> {
  const documents = await getAnyHarnessClient(connection).agentAuth.status(
    harnessKind,
    options,
  );
  return documents.find((document) => document.harness_kind === harnessKind)
    ?? null;
}

/**
 * The status subscription's handle. Declared here rather than re-exported from
 * the SDK barrel, which sits at its line cap: the shape is one method, and the
 * access layer is the only caller that holds it.
 */
export interface HarnessAuthStatusStreamHandle {
  close: (reason?: unknown) => void;
}

/** One harness's method rows, straight from its status document (door 2). */
export function getHarnessAuthMethods(
  connection: AnyHarnessClientConnection,
  harnessKind: string,
  options?: AnyHarnessRequestOptions,
): Promise<AgentAuthMethodRow[]> {
  return getAnyHarnessClient(connection).agentAuth.methods(harnessKind, options);
}

/**
 * Subscribe every harness's status documents: a snapshot per current document
 * on connect, then one event per change. The runtime's local API is
 * bearer-authed, so this is the SDK's fetch-based SSE helper rather than
 * `EventSource` (which cannot carry a header) — the same transport the session
 * stream uses.
 *
 * The WHOLE connection is threaded, `fetch` included: on the cloud surface the
 * context's transport override is the only thing that attaches the sandbox
 * gateway's `authorization` header (there is no `authToken` there), so a stream
 * opened on the module-global `fetch` 401s every attempt and the pane degrades
 * to the hook's backoff-capped re-reads — pushes gone, ~30s of staleness per
 * frame — with no error a user would ever see.
 * `AgentAuthStatusStreamOptions.fetch` is a REQUIRED key for exactly that
 * reason: dropping it again is a type error, not a silent excess property.
 */
export function openHarnessAuthStatusStream(
  connection: AnyHarnessClientConnection,
  handlers: {
    onEvent: (document: AgentAuthStatusDoc) => void;
    onError?: (error: Error) => void;
    onOpen?: () => void;
    onClose?: () => void;
  },
): HarnessAuthStatusStreamHandle {
  return streamAgentAuthStatus({
    baseUrl: connection.runtimeUrl,
    authToken: connection.authToken ?? undefined,
    fetch: connection.fetch,
    ...handlers,
  });
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
