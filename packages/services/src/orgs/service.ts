import * as orgsDb from "./db";

export type OrgRole = orgsDb.OrgRole;

export interface Organization {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	createdAt: Date;
	autumnCustomerId: string | null;
}

export interface OrganizationWithRole extends Organization {
	role: OrgRole;
}

export interface Member {
	id: string;
	organizationId: string;
	userId: string;
	role: OrgRole;
	createdAt: Date;
	user: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	} | null;
}

export interface Invitation {
	id: string;
	organizationId: string;
	email: string;
	role: OrgRole;
	status: string;
	expiresAt: Date;
	createdAt: Date;
	inviterId: string;
	inviter: {
		name: string | null;
		email: string | null;
	} | null;
}

export interface MembersAndInvitations {
	members: Member[];
	invitations: Invitation[];
	currentUserRole: OrgRole;
}

function toOrganization(row: orgsDb.OrganizationRow): Organization {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		logo: row.logo ?? null,
		createdAt: row.createdAt,
		autumnCustomerId: row.autumnCustomerId ?? null,
	};
}

function toOrganizationWithRole(row: orgsDb.MembershipRow): OrganizationWithRole {
	return {
		...toOrganization(row.organization),
		role: row.role,
	};
}

function toMember(row: orgsDb.MemberRow): Member {
	return {
		id: row.id,
		organizationId: row.organizationId,
		userId: row.userId,
		role: row.role,
		createdAt: row.createdAt,
		user: row.user
			? {
					id: row.user.id,
					name: row.user.name,
					email: row.user.email,
					image: row.user.image ?? null,
				}
			: null,
	};
}

function toInvitation(row: orgsDb.InvitationRow): Invitation {
	return {
		id: row.id,
		organizationId: row.organizationId,
		email: row.email,
		role: row.role,
		status: row.status,
		expiresAt: row.expiresAt,
		createdAt: row.createdAt,
		inviterId: row.inviterId,
		inviter: row.inviter
			? {
					name: row.inviter.name ?? null,
					email: row.inviter.email ?? null,
				}
			: null,
	};
}

export async function listOrgs(userId: string): Promise<OrganizationWithRole[]> {
	const rows = await orgsDb.listByUser(userId);
	return rows.map(toOrganizationWithRole);
}

export async function getOrg(orgId: string, userId: string): Promise<Organization | null> {
	const role = await orgsDb.getUserRole(userId, orgId);

	if (!role) {
		return null;
	}

	const row = await orgsDb.findById(orgId);
	return row ? toOrganization(row) : null;
}

export async function getUserRole(userId: string, orgId: string): Promise<OrgRole | null> {
	return orgsDb.getUserRole(userId, orgId);
}

export async function getUserOrgIds(userId: string): Promise<string[]> {
	return orgsDb.getUserOrgIds(userId);
}

export async function getFirstOrgIdForUser(userId: string): Promise<string | null> {
	const orgIds = await orgsDb.getUserOrgIds(userId);
	return orgIds[0] ?? null;
}

export async function getBasicInvitationInfo(invitationId: string): Promise<{
	email: string;
	organizationName: string;
} | null> {
	const invitation = await orgsDb.findBasicInvitationInfo(invitationId);

	if (!invitation) {
		return null;
	}

	if (invitation.status !== "pending" || invitation.expiresAt < new Date()) {
		return null;
	}

	return {
		email: invitation.email,
		organizationName: invitation.organizationName,
	};
}

export async function listMembers(orgId: string, userId: string): Promise<Member[] | null> {
	const role = await orgsDb.getUserRole(userId, orgId);

	if (!role) {
		return null;
	}

	const rows = await orgsDb.listMembers(orgId);
	return rows.map(toMember);
}

export async function listInvitations(orgId: string, userId: string): Promise<Invitation[] | null> {
	const role = await orgsDb.getUserRole(userId, orgId);

	if (!role) {
		return null;
	}

	const rows = await orgsDb.listInvitations(orgId);
	return rows.map(toInvitation);
}

export async function getMembersAndInvitations(
	orgId: string,
	userId: string,
): Promise<MembersAndInvitations | null> {
	const [role, members, invitations] = await Promise.all([
		orgsDb.getUserRole(userId, orgId),
		orgsDb.listMembers(orgId),
		orgsDb.listInvitations(orgId),
	]);

	if (!role) {
		return null;
	}

	return {
		members: members.map(toMember),
		invitations: invitations.map(toInvitation),
		currentUserRole: role,
	};
}

export async function deletePersonalOrg(userId: string): Promise<boolean> {
	return orgsDb.deletePersonalOrg(userId);
}

export async function isMember(userId: string, orgId: string): Promise<boolean> {
	const role = await orgsDb.getUserRole(userId, orgId);
	return role !== null;
}

export async function getMember(memberId: string, orgId: string): Promise<Member | null> {
	const row = await orgsDb.findMemberById(memberId, orgId);
	return row ? toMember(row) : null;
}
