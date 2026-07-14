import { useEffect, useState } from "react";
import type { DesktopWorkerBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { AuthState } from "@proliferate/product-client/host/product-host";
import { desktopWorkerStartupFailureCopy } from "@/copy/cloud/desktop-worker-copy";
import {
  ensureDesktopWorker,
  teardownDesktopWorker,
} from "@/lib/workflows/cloud/ensure-desktop-worker";
import { useOrganizationStore } from "@/stores/organizations/organization-store";
import { useToastStore } from "@/stores/toast/toast-store";

// (user, org) key the desktop worker is currently enrolled for. Module-level
// so remounts (or StrictMode double-effects) don't re-enroll for the same
// identity, but keyed so switching accounts or organizations in one app
// process rotates the worker + integration-gateway identity instead of
// silently keeping the previous identity's credentials.
let enrolledIdentityKey: string | null = null;

// Delay before retrying a failed enrollment. Long enough not to hammer an
// unreachable control plane, short enough that integrations recover without
// a restart.
const ENROLLMENT_RETRY_DELAY_MS = 15_000;

function identityKey(userId: string, organizationId: string | null): string {
  return `${userId}::${organizationId ?? ""}`;
}

// Enrollment guard transitions:
// - user change: plain re-enroll — ticket consumption rotates the worker
//   identity server-side, no teardown needed.
// - org change from a non-null org: the destructive part (confirm, closing
//   running local sessions, teardownDesktopWorker) already ran in the
//   organization switch action BEFORE the store changed; here we only
//   re-enroll under the new org.
// - org change from null (org-less user gaining their first org): adopt in
//   place — a plain re-enroll rotates the worker token without disturbing
//   running sessions.
// - sign-out: teardown (stop the local worker + delete the gateway dotfile;
//   the server-side revoke ran in sign-out orchestration while the session
//   was still valid).
//
// The organization is the store's activeOrganizationId without requiring the
// validated flag: the server membership-validates the organization on
// enrollment anyway, and waiting for validation would enroll org-less first
// and then re-enroll once the organizations query resolves on every cold
// start. A stale selection 404s server-side and the guard re-enrolls once the
// selection lifecycle falls back to a real membership.
export function useDesktopWorkerEnrollment(
  worker: DesktopWorkerBridge,
  authStatus: AuthState["status"],
  authUserId: string | null,
): void {
  const activeOrganizationId = useOrganizationStore(
    (state) => state.activeOrganizationId,
  );
  const showToast = useToastStore((state) => state.show);
  const [retryNonce, setRetryNonce] = useState(0);
  useEffect(() => {
    if (authStatus === "loading") {
      return;
    }
    if (authStatus !== "authenticated" || !authUserId) {
      // Signed out: stop the worker and clear the guard so the next login
      // (any user) re-enrolls with a fresh identity.
      if (enrolledIdentityKey !== null) {
        enrolledIdentityKey = null;
        void teardownDesktopWorker(worker);
      }
      return;
    }
    const nextIdentityKey = identityKey(authUserId, activeOrganizationId);
    if (enrolledIdentityKey === nextIdentityKey) {
      return;
    }
    // Enrolling hands the Tauri command a new ticket, which rotates the
    // worker identity and (server-side) revokes the predecessor worker +
    // gateway token under the new (user, org) scope. The effect-captured
    // organization is passed through so the enrolled org always matches the
    // guard key, even if the store changes mid-flight.
    enrolledIdentityKey = nextIdentityKey;
    let cancelled = false;
    let retryTimer: number | null = null;
    void ensureDesktopWorker(activeOrganizationId, worker, {
      onFailure: (error) => {
        if (cancelled || enrolledIdentityKey !== nextIdentityKey) {
          return;
        }
        showToast(desktopWorkerStartupFailureCopy(error), "error");
      },
    }).then((enrolled) => {
      if (enrolled || enrolledIdentityKey !== nextIdentityKey) {
        return;
      }
      // Enrollment failed (e.g. a network blip right after an org switch's
      // deliberate teardown). Leaving the guard set would make the app
      // believe a worker exists until the next identity change or restart,
      // so clear it and schedule a retry (timer only while still mounted).
      enrolledIdentityKey = null;
      if (!cancelled) {
        retryTimer = window.setTimeout(() => {
          setRetryNonce((nonce) => nonce + 1);
        }, ENROLLMENT_RETRY_DELAY_MS);
      }
    });
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [authStatus, authUserId, activeOrganizationId, retryNonce, showToast, worker]);
}
