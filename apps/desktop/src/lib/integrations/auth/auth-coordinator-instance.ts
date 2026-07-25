import {
  clearStoredAuthSession,
  getStoredAuthSession,
  setStoredAuthSession,
} from "@/lib/access/tauri/auth";
import { useAuthStore } from "@/stores/auth/auth-store";
import { createAuthCoordinator } from "./auth-coordinator";
import {
  isDefinitiveAuthRejection,
  isSessionExpiring,
  refreshDesktopUserSession,
} from "./proliferate-auth";

// Host wiring seam for the ONE desktop auth coordinator. The store bridge is
// bound at module scope (not registered from a React effect) because the raw
// Cloud middleware needs the coordinator before any component mounts; PR 1
// folds this seam into the desktop product host. Nothing else may import the
// stored-credential mutators from lib/access/tauri/auth.
export const desktopAuthCoordinator = createAuthCoordinator({
  getAuthState: () => useAuthStore.getState(),
  setAuthState: (patch) => {
    useAuthStore.setState(patch);
  },
  getStoredCredentials: getStoredAuthSession,
  setStoredCredentials: setStoredAuthSession,
  clearStoredCredentials: clearStoredAuthSession,
  refreshSession: refreshDesktopUserSession,
  isSessionExpiring: (session) => isSessionExpiring(session),
  isDefinitiveRejection: isDefinitiveAuthRejection,
});
