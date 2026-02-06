/**
 * Admin module types.
 *
 * DB row shapes for admin queries.
 */

// ============================================
// DB Row Types
// ============================================

export interface UserRow {
	id: string;
	email: string;
	name: string | null;
	createdAt: string;
}

export interface UserWithMembershipsRow extends UserRow {
	member?: Array<{
		organizationId: string;
		role: string;
		organization: {
			id: string;
			name: string;
		} | null;
	}>;
}

export interface OrganizationRow {
	id: string;
	name: string;
	slug: string;
	is_personal: boolean | null;
	createdAt: string;
}

export interface OrganizationWithMembersRow extends OrganizationRow {
	member?: Array<{
		userId: string;
	}>;
}

export interface MembershipRow {
	userId: string;
	organizationId: string;
	role: string;
	organization?: {
		id: string;
		name: string;
	} | null;
}
