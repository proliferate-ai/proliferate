import { getTargetRuntimeAccess } from "@proliferate/cloud-sdk";
import "@/lib/access/cloud/client";
import {
  setSshDirectTargetProfile,
  type SshDirectTargetProfile,
} from "@/lib/access/tauri/ssh-target-profile";

/**
 * Resolve the per-runtime AnyHarness bearer for a direct SSH attach.
 *
 * Enrollment caches the bearer on the local profile so attach works offline.
 * Profiles saved before bearer enforcement lack it; recover it once from the
 * owner-gated runtime-access endpoint and persist it back. Recovery failures
 * (pre-bearer target, org-scoped target, Cloud unreachable) degrade to a
 * tokenless attach, which unenforced runtimes still accept.
 */
export async function resolveSshDirectTargetBearer(
  profile: SshDirectTargetProfile,
): Promise<string | null> {
  if (profile.anyharnessBearerToken) {
    return profile.anyharnessBearerToken;
  }
  try {
    const access = await getTargetRuntimeAccess(profile.targetId);
    const bearer = access.anyharnessBearerToken.trim();
    if (!bearer) {
      return null;
    }
    await setSshDirectTargetProfile({
      ...profile,
      anyharnessBearerToken: bearer,
    });
    return bearer;
  } catch {
    return null;
  }
}
