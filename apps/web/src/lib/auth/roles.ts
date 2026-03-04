/**
 * Pure role/permission utilities — safe for client components.
 *
 * Server-only helpers that depend on @proliferate/services live in permissions.ts.
 */

export type OrgRole = "owner" | "admin" | "member";

export const ROLE_HIERARCHY: Record<OrgRole, number> = {
	owner: 3,
	admin: 2,
	member: 1,
};

export type Permission =
	| "view"
	| "create_session"
	| "add_repo"
	| "manage_connections"
	| "invite_members"
	| "manage_roles"
	| "manage_domains"
	| "delete_org";

const ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
	owner: [
		"view",
		"create_session",
		"add_repo",
		"manage_connections",
		"invite_members",
		"manage_roles",
		"manage_domains",
		"delete_org",
	],
	admin: ["view", "create_session", "add_repo", "manage_connections", "invite_members"],
	member: ["view", "create_session"],
};

export function hasPermission(role: OrgRole, permission: Permission): boolean {
	return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function hasRoleOrHigher(userRole: OrgRole, requiredRole: OrgRole): boolean {
	return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}
