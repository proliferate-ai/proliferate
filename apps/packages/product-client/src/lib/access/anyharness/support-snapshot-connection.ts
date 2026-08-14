import {
  AnyHarnessClient,
  supportWindowResponseBytes,
} from "@anyharness/sdk";
import type {
  DesktopRuntimeBridge,
  LocalRuntimeConnection,
  SupportSnapshotPreparation,
  SupportSnapshotWorkspaceBindingV1,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  BundledLocalSupportSelection,
  ResolvedSupportSnapshotAccess,
  ResolveSupportSnapshotAccessInput,
} from "#product/lib/domain/support/support-snapshot-access-contract";
import {
  SUPPORT_EVENT_LIMIT,
  SUPPORT_EVENT_LIST_BYTES,
  SUPPORT_RAW_NOTIFICATION_LIMIT,
  SUPPORT_RAW_NOTIFICATION_LIST_BYTES,
  SUPPORT_SESSION_LIMIT,
  SUPPORT_SESSION_LIST_BYTES,
  isSupportIdentity,
  type BoundSupportSessionEvidencePort,
} from "#product/lib/domain/support/support-session-contract";
import {
  collectBoundSupportSessionEvidence,
  type CollectedSupportSessionEvidence,
} from "#product/lib/workflows/support/support-session-evidence";

const NO_WORKSPACE_BINDING = {
  kind: "none",
  reason: "no_selected_bundled_local_workspace",
} as const;

type BoundAccess = Extract<ResolvedSupportSnapshotAccess, { state: "resolved" }>;

const BOUND_SUPPORT_PORTS = new WeakMap<BoundAccess, BoundSupportSessionEvidencePort>();

export async function resolveSupportSnapshotAccess(
  input: ResolveSupportSnapshotAccessInput,
): Promise<ResolvedSupportSnapshotAccess> {
  const proof = await proveBundledLocalConnection(input);
  if (proof.state !== "resolved") {
    return input.selection === "recent_activity"
      ? { state: "none", binding: NO_WORKSPACE_BINDING }
      : proof;
  }

  const workspace = Object.freeze({
    kind: "bundled_local",
    workspaceId: proof.workspaceId,
    anyharnessWorkspaceId: proof.anyharnessWorkspaceId,
  }) satisfies Extract<SupportSnapshotWorkspaceBindingV1, { kind: "bundled_local" }>;
  if (input.selection === "recent_activity") {
    return bindSupportAccess(
      Object.freeze({ kind: "recent_activity", workspace }),
      proof.connection,
    );
  }

  const active = input.activeSession;
  const materializedSessionId = active?.materializedSessionId ?? "";
  if (
    !active
    || !isSupportIdentity(active.uiSessionId)
    || active.directoryWorkspaceId !== proof.workspaceId
    || !isSupportIdentity(materializedSessionId)
  ) {
    return { state: "ineligible", reason: "session_mapping_stale" };
  }

  return bindSupportAccess(Object.freeze({
    kind: "active_session",
    workspace,
    uiSessionId: active.uiSessionId,
    materializedSessionId,
  }), proof.connection);
}

export interface CollectResolvedSupportSessionEvidenceInput {
  preparation: SupportSnapshotPreparation;
  access: ResolvedSupportSnapshotAccess;
  cancellationSignal?: AbortSignal;
  isSelectionCurrent?: () => boolean;
}

export function collectResolvedSupportSessionEvidence(
  input: CollectResolvedSupportSessionEvidenceInput,
): Promise<CollectedSupportSessionEvidence> {
  if (input.cancellationSignal?.aborted || !selectionIsCurrent(input.isSelectionCurrent)) {
    return Promise.resolve({ state: "cancelled" });
  }
  if (input.access.state === "none") {
    return Promise.resolve({
      state: "omitted",
      sessionEvidenceJson: null,
      sessionCollection: {
        state: "omitted",
        reason: "no_selected_bundled_local_workspace",
      },
    });
  }
  if (input.access.state !== "resolved") return Promise.resolve({ state: "cancelled" });
  const port = BOUND_SUPPORT_PORTS.get(input.access);
  if (!port) return Promise.resolve({ state: "cancelled" });
  return collectBoundSupportSessionEvidence({
    preparation: input.preparation,
    port,
    selection: input.access.selection,
    cancellationSignal: input.cancellationSignal,
    isSelectionCurrent: input.isSelectionCurrent,
  });
}

type ConnectionProof =
  | {
      state: "resolved";
      workspaceId: string;
      anyharnessWorkspaceId: string;
      connection: LocalRuntimeConnection;
    }
  | Extract<ResolvedSupportSnapshotAccess, { state: "ineligible" }>;

async function proveBundledLocalConnection(
  input: ResolveSupportSnapshotAccessInput,
): Promise<ConnectionProof> {
  if (!input.runtime) {
    return { state: "ineligible", reason: "native_capability_unavailable" };
  }
  if (input.capturedRuntime.source !== "native_capture") {
    return { state: "ineligible", reason: "captured_runtime_untrusted" };
  }
  const capturedUrl = normalizeRuntimeUrl(input.capturedRuntime.url, true);
  if (!capturedUrl) {
    return { state: "ineligible", reason: "captured_runtime_untrusted" };
  }
  const workspace = input.selectedWorkspace;
  if (
    workspace?.kind !== "bundled_local"
    || !isSupportIdentity(workspace.workspaceId)
    || !isSupportIdentity(workspace.anyharnessWorkspaceId)
  ) {
    return { state: "ineligible", reason: "workspace_ineligible" };
  }

  let snapshot: Awaited<ReturnType<DesktopRuntimeBridge["getConnection"]>>;
  try {
    snapshot = await input.runtime.getConnection();
  } catch {
    return { state: "ineligible", reason: "native_capability_unavailable" };
  }
  if (snapshot.status !== "healthy") {
    return { state: "ineligible", reason: "runtime_unhealthy" };
  }
  const trustedUrl = normalizeRuntimeUrl(snapshot.connection.runtimeUrl, false);
  if (!trustedUrl || trustedUrl !== capturedUrl) {
    return { state: "ineligible", reason: "runtime_mismatch" };
  }

  return {
    state: "resolved",
    workspaceId: workspace.workspaceId,
    anyharnessWorkspaceId: workspace.anyharnessWorkspaceId,
    connection: {
      runtimeUrl: trustedUrl,
      authToken: snapshot.connection.authToken ?? undefined,
      ...(snapshot.connection.fetch ? { fetch: snapshot.connection.fetch } : {}),
    },
  };
}

function bindSupportAccess(
  selection: BundledLocalSupportSelection,
  connection: LocalRuntimeConnection,
): BoundAccess {
  const client = new AnyHarnessClient({
    baseUrl: connection.runtimeUrl,
    authToken: connection.authToken ?? undefined,
    ...(connection.fetch ? { fetch: connection.fetch } : {}),
  });
  const access = Object.freeze({ state: "resolved", selection }) as BoundAccess;
  const anyharnessWorkspaceId = selection.workspace.anyharnessWorkspaceId;
  const port = Object.freeze({
    async listSessions(
      request: Parameters<BoundSupportSessionEvidencePort["listSessions"]>[0],
    ) {
      const response = await (request.mode === "exact"
        ? client.sessions.listSupportWindow(anyharnessWorkspaceId, {
            mode: "exact",
            sessionId: request.sessionId,
            updatedAtTo: request.updatedAtTo,
            limit: 1,
            maxResponseBytes: SUPPORT_SESSION_LIST_BYTES,
            request: { signal: request.signal },
          })
        : client.sessions.listSupportWindow(anyharnessWorkspaceId, {
            mode: "recent",
            updatedAtFrom: request.updatedAtFrom,
            updatedAtTo: request.updatedAtTo,
            limit: SUPPORT_SESSION_LIMIT,
            maxResponseBytes: SUPPORT_SESSION_LIST_BYTES,
            request: { signal: request.signal },
          }));
      return measuredResponse(response);
    },
    async listEvents(request: Parameters<BoundSupportSessionEvidencePort["listEvents"]>[0]) {
      const response = await client.sessions.listEventsSupportWindow(request.sessionId, {
        timestampFrom: request.timestampFrom,
        timestampTo: request.timestampTo,
        limit: SUPPORT_EVENT_LIMIT,
        maxResponseBytes: SUPPORT_EVENT_LIST_BYTES,
        request: { signal: request.signal },
      });
      return measuredResponse(response);
    },
    async listRawNotifications(
      request: Parameters<BoundSupportSessionEvidencePort["listRawNotifications"]>[0],
    ) {
      const response = await client.sessions.listRawNotificationsSupportWindow(request.sessionId, {
        timestampFrom: request.timestampFrom,
        timestampTo: request.timestampTo,
        limit: SUPPORT_RAW_NOTIFICATION_LIMIT,
        maxResponseBytes: SUPPORT_RAW_NOTIFICATION_LIST_BYTES,
        request: { signal: request.signal },
      });
      return measuredResponse(response);
    },
  }) as BoundSupportSessionEvidencePort;
  BOUND_SUPPORT_PORTS.set(access, port);
  return access;
}

function measuredResponse(
  response: Parameters<typeof supportWindowResponseBytes>[0],
): { value: object; responseBytes: number } {
  return { value: response, responseBytes: supportWindowResponseBytes(response) };
}

function selectionIsCurrent(check: (() => boolean) | undefined): boolean {
  try {
    return check?.() !== false;
  } catch {
    return false;
  }
}

function normalizeRuntimeUrl(value: string, requireLoopback: boolean): string | null {
  if (
    !value
    || value !== value.trim()
    || !isWellFormedUnicode(value)
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return null;
  const trimmed = value.replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || (requireLoopback && !isLoopbackHost(parsed.hostname))
    ) {
      return null;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]";
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
