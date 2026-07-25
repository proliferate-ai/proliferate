// Session authority identity (web-desktop-client-unification.md §4.2, §5.1).
//
// An authority is the resolved actor behind remote caches and credential
// ordering: an explicit anonymous actor or a concrete user. `null` means the
// host has not resolved any authority yet (pre-bootstrap); presentation
// states such as "bootstrapping" and "unreachable" are never authorities.

export type AuthAuthority =
  | { kind: "anonymous" }
  | { kind: "user"; userId: string };

const ANONYMOUS_AUTHORITY: AuthAuthority = { kind: "anonymous" };

export function anonymousAuthority(): AuthAuthority {
  return ANONYMOUS_AUTHORITY;
}

export function userAuthority(userId: string): AuthAuthority {
  return { kind: "user", userId };
}

// Stable, credential-free identity string: "anonymous" or "user:<id>".
export function authorityKey(authority: AuthAuthority): string {
  return authority.kind === "user" ? `user:${authority.userId}` : "anonymous";
}

export function isSameAuthority(
  a: AuthAuthority | null,
  b: AuthAuthority | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.kind === "anonymous") {
    return b.kind === "anonymous";
  }
  return b.kind === "user" && b.userId === a.userId;
}
