import type { StoredAuthSession } from "@/platform/tauri/auth";

type AuthSessionProvider = () => StoredAuthSession | null;

let authSessionProvider: AuthSessionProvider = () => null;

export function registerCurrentAuthSessionProvider(provider: AuthSessionProvider): void {
  authSessionProvider = provider;
}

export function getCurrentAuthSession(): StoredAuthSession | null {
  return authSessionProvider();
}
