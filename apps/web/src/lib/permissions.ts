import { orgs } from "@proliferate/services";
import { type OrgRole, type Permission, hasPermission, hasRoleOrHigher } from "./roles";

export {
	type OrgRole,
	ROLE_HIERARCHY,
	type Permission,
	hasPermission,
	hasRoleOrHigher,
} from "./roles";

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
