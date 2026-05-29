import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";

type AuthSessionProvider = () => StoredAuthSession | null;

let authSessionProvider: AuthSessionProvider = () => null;

export function registerCurrentAuthSessionProvider(provider: AuthSessionProvider): void {
  authSessionProvider = provider;
}

export function getCurrentAuthSession(): StoredAuthSession | null {
  return authSessionProvider();
}
