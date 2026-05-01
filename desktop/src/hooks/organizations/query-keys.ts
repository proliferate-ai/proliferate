export function organizationsRootKey() {
  return ["organizations"] as const;
}

export function organizationsListKey() {
  return [...organizationsRootKey(), "list"] as const;
}

export function organizationMembersKey(organizationId: string | null) {
  return [...organizationsRootKey(), organizationId, "members"] as const;
}

export function organizationInvitationsKey(organizationId: string | null) {
  return [...organizationsRootKey(), organizationId, "invitations"] as const;
}
