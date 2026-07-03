import { useEffect } from "react";
import {
  ensureDesktopWorker,
  teardownDesktopWorker,
} from "@/lib/workflows/cloud/ensure-desktop-worker";
import { useAuthStore } from "@/stores/auth/auth-store";

// User id the desktop worker is currently enrolled for. Module-level so
// remounts (or StrictMode double-effects) don't re-enroll for the same user,
// but keyed by user so switching accounts in one app process rotates the
// worker + integration-gateway identity instead of silently keeping the
// previous user's credentials.
let enrolledUserId: string | null = null;

export function useDesktopWorkerEnrollment(): void {
  const authStatus = useAuthStore((state) => state.status);
  const authUserId = useAuthStore((state) => state.user?.id ?? null);
  useEffect(() => {
    if (authStatus === "bootstrapping") {
      return;
    }
    if (authStatus !== "authenticated" || !authUserId) {
      // Signed out: revoke + stop the worker and clear the guard so the next
      // login (any user) re-enrolls with a fresh identity.
      if (enrolledUserId !== null) {
        enrolledUserId = null;
        void teardownDesktopWorker();
      }
      return;
    }
    if (enrolledUserId === authUserId) {
      return;
    }
    // Fresh login or a different user in the same app process: enrolling hands
    // the Tauri command a new ticket, which rotates the worker identity and
    // (server-side) revokes the predecessor worker + gateway token.
    //
    // Claim the guard synchronously so concurrent renders don't double-enroll,
    // but ensureDesktopWorker swallows its own errors — if it fails silently we
    // must clear the guard, otherwise a single transient failure wedges this
    // user out of a worker until sign-out/in. Reset only when the guard still
    // holds the id we set: a newer sign-out or user switch may have already
    // claimed it, and clobbering that would strand the newer identity. This is
    // not a retry loop — one reset per failed attempt; the next effect run
    // (re-bootstrap, status change, or user switch) retries.
    const enrollingUserId = authUserId;
    enrolledUserId = enrollingUserId;
    void ensureDesktopWorker().then((ok) => {
      if (!ok && enrolledUserId === enrollingUserId) {
        enrolledUserId = null;
      }
    });
  }, [authStatus, authUserId]);
}
