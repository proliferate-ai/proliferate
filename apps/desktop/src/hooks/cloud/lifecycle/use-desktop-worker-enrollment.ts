import { useEffect } from "react";
import { ensureDesktopWorker } from "@/lib/workflows/cloud/ensure-desktop-worker";
import { useAuthStore } from "@/stores/auth/auth-store";

// Guards the desktop worker enrollment so it fires once per authenticated
// session, whether reached via fresh login or a restored-session launch.
let desktopWorkerEnrollmentStarted = false;

export function useDesktopWorkerEnrollment(): void {
  const authStatus = useAuthStore((s) => s.status);
  useEffect(() => {
    if (authStatus !== "authenticated" || desktopWorkerEnrollmentStarted) {
      return;
    }
    desktopWorkerEnrollmentStarted = true;
    void ensureDesktopWorker();
  }, [authStatus]);
}
