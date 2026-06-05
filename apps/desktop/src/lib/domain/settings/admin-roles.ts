export function isSettingsOwnerRole(role: string | null | undefined): boolean {
  return role === "owner";
}

export function isSettingsAdminRole(role: string | null | undefined): boolean {
  return isSettingsOwnerRole(role) || role === "admin";
}
