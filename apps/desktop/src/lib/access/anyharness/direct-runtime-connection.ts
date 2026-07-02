import type { DirectRuntimeRef } from "@/lib/domain/compute/direct-runtime";
import {
  refreshSshDirectTargetBearer,
  resolveSshDirectTargetBearer,
} from "@/lib/access/anyharness/ssh-direct-bearer";
import {
  getSshDirectTargetProfile,
  type SshDirectTargetProfile,
} from "@/lib/access/tauri/ssh-target-profile";
import {
  ensureSshAnyHarnessTunnel,
  type EnsureSshAnyHarnessTunnelResult,
} from "@/lib/access/tauri/ssh-tunnel";
import { useDirectRuntimeConnectionStore } from "@/stores/compute/direct-runtime-connection-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export interface DirectRuntimeConnection {
  baseUrl: string;
  authToken: string | null;
}

// Per-target runtime bearer, resolved at most once per app run outside the
// rejection-refresh path. `null` records a target that has no bearer (never
// enforced or Cloud unreachable) so resolves stay offline-safe and do not
// re-hit the runtime-access endpoint on every workspace resolution.
const bearerByTargetId = new Map<string, string | null>();

export function resetDirectRuntimeBearerCacheForTest(): void {
  bearerByTargetId.clear();
}

/**
 * The single place transport resolution happens for the direct-runtime
 * family. Loopback resolves to the local harness runtime; ssh resolves to an
 * ensured tunnel plus the per-runtime bearer. Remote attach outcomes are
 * reported to the direct-runtime connection store (connecting -> attached /
 * unreachable); loopback state derives from the harness bootstrap instead.
 */
export async function resolveDirectRuntimeConnection(
  ref: DirectRuntimeRef,
): Promise<DirectRuntimeConnection> {
  if (ref.transport === "loopback") {
    return {
      baseUrl: useHarnessConnectionStore.getState().runtimeUrl,
      authToken: null,
    };
  }
  if (ref.targetId === null) {
    throw new Error("A remote direct runtime requires a target id.");
  }
  return resolveSshTransportConnection(ref.targetId);
}

async function resolveSshTransportConnection(
  targetId: string,
): Promise<DirectRuntimeConnection> {
  const dispatch = useDirectRuntimeConnectionStore.getState().dispatchConnectionEvent;
  dispatch(targetId, { type: "connect_started" });

  const profile = await getSshDirectTargetProfile(targetId);
  if (!profile) {
    const message =
      "SSH direct access is not configured for this target. "
      + "Add the SSH host, user, and key in Compute settings.";
    dispatch(targetId, { type: "attach_failed", error: message });
    throw new Error(message);
  }

  try {
    const { tunnel, authToken } = await ensureTunnelWithBearer(targetId, profile);
    dispatch(targetId, {
      type: "attached",
      baseUrl: tunnel.localUrl,
      authToken,
    });
    return { baseUrl: tunnel.localUrl, authToken };
  } catch (error) {
    dispatch(targetId, { type: "attach_failed", error: errorMessage(error) });
    throw error;
  }
}

async function ensureTunnelWithBearer(
  targetId: string,
  profile: SshDirectTargetProfile,
): Promise<{ tunnel: EnsureSshAnyHarnessTunnelResult; authToken: string | null }> {
  // The profile bearer is authoritative (enrollment writes it); the memory
  // cache only stands in for the runtime-access fetch when the profile
  // predates bearer enforcement.
  let authToken: string | null;
  if (profile.anyharnessBearerToken) {
    authToken = profile.anyharnessBearerToken;
  } else {
    const cached = bearerByTargetId.get(targetId);
    authToken = cached !== undefined
      ? cached
      : await resolveSshDirectTargetBearer(profile);
  }
  bearerByTargetId.set(targetId, authToken);

  try {
    const tunnel = await ensureTunnel(profile, authToken);
    return { tunnel, authToken };
  } catch (error) {
    if (!isRuntimeBearerRejection(error)) {
      throw error;
    }
    // The runtime rejected the bearer Desktop holds (re-enrollment rotates
    // it). Re-fetch from the runtime-access endpoint and retry once.
    const refreshed = await refreshSshDirectTargetBearer(profile);
    if (!refreshed || refreshed === authToken) {
      throw error;
    }
    bearerByTargetId.set(targetId, refreshed);
    const tunnel = await ensureTunnel(profile, refreshed);
    return { tunnel, authToken: refreshed };
  }
}

function ensureTunnel(
  profile: SshDirectTargetProfile,
  authToken: string | null,
): Promise<EnsureSshAnyHarnessTunnelResult> {
  return ensureSshAnyHarnessTunnel({
    targetId: profile.targetId,
    sshHost: profile.sshHost,
    sshUser: profile.sshUser,
    sshPort: profile.sshPort,
    identityFile: profile.identityFile ?? null,
    remoteAnyHarnessPort: profile.remoteAnyHarnessPort,
    anyharnessBearerToken: authToken,
  });
}

// Mirrors the unauthorized-access messages produced by
// ssh_tunnel.rs::verify_anyharness_access — the tunnel-ensure command is the
// authed probe, so its error string is the only 401/403 signal Desktop gets.
function isRuntimeBearerRejection(error: unknown): boolean {
  return errorMessage(error).includes("runtime bearer");
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
