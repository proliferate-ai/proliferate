/**
 * The direct-runtime family: persistent, user-owned AnyHarness runtimes that
 * Desktop attaches to instead of provisioning. "Local" is the degenerate case
 * where the transport is loopback; an SSH target is the identical thing where
 * the transport is a tunnel. Transport is a property derived from the ref —
 * never a category — and may only influence connection resolution and
 * presentation (specs/tbd/ssh-personal-target-design.md §0, §3.2).
 */

export type DirectRuntimeTransport = "loopback" | "ssh";

export type DirectRuntimeConnectionState =
  | "attached"
  | "connecting"
  | "unreachable"
  | "detached";

export interface DirectRuntimeRef {
  /** null identifies this machine's loopback runtime. */
  targetId: string | null;
  transport: DirectRuntimeTransport;
  displayName: string;
}

export function directRuntimeTransport(targetId: string | null): DirectRuntimeTransport {
  return targetId === null ? "loopback" : "ssh";
}

export function loopbackDirectRuntimeRef(displayName = "This Mac"): DirectRuntimeRef {
  return { targetId: null, transport: "loopback", displayName };
}

export function sshDirectRuntimeRef(
  targetId: string,
  displayName?: string,
): DirectRuntimeRef {
  return {
    targetId,
    transport: directRuntimeTransport(targetId),
    displayName: displayName ?? targetId,
  };
}

export function directRuntimeConnectionKey(targetId: string | null): string {
  return targetId === null ? "loopback" : `target:${targetId}`;
}

/**
 * The loopback runtime has no attach machinery of its own: its connection
 * state derives from the local harness bootstrap health.
 */
export function loopbackDirectRuntimeConnectionState(
  harnessConnectionState: "connecting" | "healthy" | "failed",
): DirectRuntimeConnectionState {
  switch (harnessConnectionState) {
    case "healthy":
      return "attached";
    case "connecting":
      return "connecting";
    case "failed":
      return "unreachable";
  }
}

export interface DirectRuntimeConnectionSnapshot {
  connectionState: DirectRuntimeConnectionState;
  baseUrl: string | null;
  authToken: string | null;
  lastError: string | null;
}

export type DirectRuntimeConnectionEvent =
  | { type: "connect_started" }
  | { type: "attached"; baseUrl: string; authToken: string | null }
  | { type: "attach_failed"; error: string }
  | { type: "detached" };

export const DETACHED_DIRECT_RUNTIME_CONNECTION: DirectRuntimeConnectionSnapshot = {
  connectionState: "detached",
  baseUrl: null,
  authToken: null,
  lastError: null,
};

export function reduceDirectRuntimeConnection(
  previous: DirectRuntimeConnectionSnapshot,
  event: DirectRuntimeConnectionEvent,
): DirectRuntimeConnectionSnapshot {
  switch (event.type) {
    case "connect_started":
      // Keep the last resolved connection while re-ensuring so an already
      // attached runtime does not flash-drop its address mid-refresh.
      return { ...previous, connectionState: "connecting" };
    case "attached":
      return {
        connectionState: "attached",
        baseUrl: event.baseUrl,
        authToken: event.authToken,
        lastError: null,
      };
    case "attach_failed":
      return {
        connectionState: "unreachable",
        baseUrl: null,
        authToken: null,
        lastError: event.error,
      };
    case "detached":
      return DETACHED_DIRECT_RUNTIME_CONNECTION;
  }
}
