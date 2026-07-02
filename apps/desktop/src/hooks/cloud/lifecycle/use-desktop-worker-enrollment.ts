import { useEffect } from "react";
import {
  ensureDesktopWorker,
  teardownDesktopWorker,
} from "@/lib/workflows/cloud/ensure-desktop-worker";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useOrganizationStore } from "@/stores/organizations/organization-store";

// (user, org) key the desktop worker is currently enrolled for. Module-level
// so remounts (or StrictMode double-effects) don't re-enroll for the same
// identity, but keyed so switching accounts or organizations in one app
// process rotates the worker + integration-gateway identity instead of
// silently keeping the previous identity's credentials.
let enrolledIdentityKey: string | null = null;

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
// - sign-out: teardown (revoke + stop the local worker).
export function useDesktopWorkerEnrollment(): void {
  const authStatus = useAuthStore((state) => state.status);
  const authUserId = useAuthStore((state) => state.user?.id ?? null);
  const activeOrganizationId = useOrganizationStore(
    (state) => state.activeOrganizationId,
  );
  useEffect(() => {
    if (authStatus === "bootstrapping") {
      return;
    }
    if (authStatus !== "authenticated" || !authUserId) {
      // Signed out: revoke + stop the worker and clear the guard so the next
      // login (any user) re-enrolls with a fresh identity.
      if (enrolledIdentityKey !== null) {
        enrolledIdentityKey = null;
        void teardownDesktopWorker();
      }
      return;
    }
    const nextIdentityKey = identityKey(authUserId, activeOrganizationId);
    if (enrolledIdentityKey === nextIdentityKey) {
      return;
    }
    // Enrolling hands the Tauri command a new ticket, which rotates the
    // worker identity and (server-side) revokes the predecessor worker +
    // gateway token under the new (user, org) scope.
    enrolledIdentityKey = nextIdentityKey;
    void ensureDesktopWorker();
  }, [authStatus, authUserId, activeOrganizationId]);
}
