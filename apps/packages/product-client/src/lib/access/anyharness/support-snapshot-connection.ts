import type {
  DesktopRuntimeBridge,
  SupportSnapshotWorkspaceBindingV1,
} from "@proliferate/product-client/host/desktop-bridge";
import type {
  BundledLocalSupportConnection,
  ResolvedSupportSnapshotAccess,
  ResolveSupportSnapshotAccessInput,
} from "#product/lib/domain/support/support-snapshot-access-contract";

const NO_WORKSPACE_BINDING = {
  kind: "none",
  reason: "no_selected_bundled_local_workspace",
} as const;

export async function resolveSupportSnapshotAccess(
  input: ResolveSupportSnapshotAccessInput,
): Promise<ResolvedSupportSnapshotAccess> {
  const failure = await proveBundledLocalConnection(input);
  if (failure.state !== "resolved") {
    return input.selection === "recent_activity"
      ? { state: "none", binding: NO_WORKSPACE_BINDING }
      : failure;
  }

  const workspace: Extract<SupportSnapshotWorkspaceBindingV1, { kind: "bundled_local" }> = {
    kind: "bundled_local",
    workspaceId: failure.workspaceId,
    anyharnessWorkspaceId: failure.connection.anyharnessWorkspaceId,
  };
  if (input.selection === "recent_activity") {
    return {
      state: "resolved",
      connection: failure.connection,
      selection: { kind: "recent_activity", workspace },
    };
  }

  const active = input.activeSession;
  const materializedSessionId = active?.materializedSessionId ?? "";
  if (
    !active
    || !isBoundedIdentity(active.uiSessionId)
    || active.directoryWorkspaceId !== failure.workspaceId
    || !isBoundedIdentity(materializedSessionId)
  ) {
    return { state: "ineligible", reason: "session_mapping_stale" };
  }

  return {
    state: "resolved",
    connection: failure.connection,
    selection: {
      kind: "active_session",
      workspace,
      uiSessionId: active.uiSessionId,
      materializedSessionId,
    },
  };
}

type ConnectionProof =
  | {
      state: "resolved";
      workspaceId: string;
      connection: BundledLocalSupportConnection;
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
    || !isBoundedIdentity(workspace.workspaceId)
    || !isBoundedIdentity(workspace.anyharnessWorkspaceId)
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
    connection: {
      runtimeUrl: trustedUrl,
      anyharnessWorkspaceId: workspace.anyharnessWorkspaceId,
    } as BundledLocalSupportConnection,
  };
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

function isBoundedIdentity(value: string): boolean {
  return value.length > 0
    && value === value.trim()
    && isWellFormedUnicode(value)
    && !/[\u0000-\u001f\u007f]/.test(value)
    && new TextEncoder().encode(value).length <= 128;
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
