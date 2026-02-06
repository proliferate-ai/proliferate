import { orgs } from "@proliferate/services";

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

export async function getUserOrgRole(
	userId: string,
	organizationId: string,
): Promise<OrgRole | null> {
	const role = await orgs.getUserRole(userId, organizationId);
	return role ?? null;
}

export async function requirePermission(
	userId: string,
	organizationId: string,
	permission: Permission,
): Promise<{ allowed: true; role: OrgRole } | { allowed: false; error: string }> {
	const role = await getUserOrgRole(userId, organizationId);

	if (!role) {
		return { allowed: false, error: "Not a member of this organization" };
	}

	if (!hasPermission(role, permission)) {
		return {
			allowed: false,
			error: `Insufficient permissions. Required: ${permission}`,
		};
	}

	return { allowed: true, role };
}

export async function requireRole(
	userId: string,
	organizationId: string,
	requiredRole: OrgRole,
): Promise<{ allowed: true; role: OrgRole } | { allowed: false; error: string }> {
	const role = await getUserOrgRole(userId, organizationId);

	if (!role) {
		return { allowed: false, error: "Not a member of this organization" };
	}

	if (!hasRoleOrHigher(role, requiredRole)) {
		return {
			allowed: false,
			error: `Insufficient role. Required: ${requiredRole} or higher`,
		};
	}

	return { allowed: true, role };
}

export async function canManageConnection(
	userId: string,
	organizationId: string,
	connectionCreatedBy: string | null,
): Promise<boolean> {
	// Connection creator can always manage their own connection
	if (connectionCreatedBy === userId) {
		return true;
	}

	// Otherwise, need admin+ role
	const role = await getUserOrgRole(userId, organizationId);
	if (!role) return false;

	return hasRoleOrHigher(role, "admin");
}
