import { authorityKey, type AuthAuthority } from "./auth-authority";

interface AnyHarnessCacheScopeInput {
  apiBaseUrl: string;
  authority: AuthAuthority;
  authGeneration: number;
}

// Cache scope identity: deployment + explicit authority + session authority
// epoch (web-desktop-client-unification.md §5.1). Presentation/transport
// statuses (bootstrapping/unreachable) and credentials never participate;
// the generation isolates two logins by the same principal.
export function buildAnyHarnessCacheScopeKey(
  input: AnyHarnessCacheScopeInput,
): string {
  const apiBaseUrl = input.apiBaseUrl.trim() || "unknown-deployment";
  return `${apiBaseUrl}::${authorityKey(input.authority)}::gen:${input.authGeneration}`;
}
