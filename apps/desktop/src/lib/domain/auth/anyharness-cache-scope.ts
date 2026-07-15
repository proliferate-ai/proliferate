import type { AuthClientStatus } from "./auth-state-mapping";

interface AnyHarnessCacheScopeInput {
  apiBaseUrl: string;
  authStatus: AuthClientStatus;
  authUserId: string | null;
}

export function buildAnyHarnessCacheScopeKey(
  input: AnyHarnessCacheScopeInput,
): string {
  const apiBaseUrl = input.apiBaseUrl.trim() || "unknown-deployment";
  const authUserId = input.authUserId?.trim() ?? "";

  if (input.authStatus === "authenticated" && authUserId) {
    return `${apiBaseUrl}::user:${authUserId}`;
  }

  return `${apiBaseUrl}::${input.authStatus}`;
}
