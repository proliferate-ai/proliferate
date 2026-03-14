import {
	type InferSelectModel,
	and,
	asc,
	eq,
	getDb,
	gt,
	invitation,
	member,
	organization,
	sessions,
	type user,
} from "../db/client";

export type OrganizationRow = InferSelectModel<typeof organization>;
export type MemberDbRow = InferSelectModel<typeof member>;
export type InvitationDbRow = InferSelectModel<typeof invitation>;
export type UserRow = InferSelectModel<typeof user>;
export type OrgRole = MemberDbRow["role"];

export interface MembershipRow {
	organizationId: string;
	role: OrgRole;
	organization: OrganizationRow;
}

export interface MemberRow extends MemberDbRow {
	user: Pick<UserRow, "id" | "name" | "email" | "image"> | null;
}

export interface InvitationRow extends InvitationDbRow {
	inviter: Pick<UserRow, "name" | "email"> | null;
}

export async function listByUser(userId: string): Promise<MembershipRow[]> {
	const db = getDb();
	const results = await db.query.member.findMany({
		where: eq(member.userId, userId),
		with: {
			organization: true,
		},
	});

	return results.map((result) => ({
		organizationId: result.organizationId,
		role: result.role,
		organization: result.organization,
	}));
}

export async function findById(orgId: string): Promise<OrganizationRow | null> {
	const db = getDb();
	const result = await db.query.organization.findFirst({
		where: eq(organization.id, orgId),
	});

	return result ?? null;
}

export async function getUserRole(userId: string, orgId: string): Promise<OrgRole | null> {
	const db = getDb();
	const result = await db.query.member.findFirst({
		where: and(eq(member.userId, userId), eq(member.organizationId, orgId)),
		columns: {
			role: true,
		},
	});

	return result?.role ?? null;
}

export async function listMembers(orgId: string): Promise<MemberRow[]> {
	const db = getDb();
	return db.query.member.findMany({
		where: eq(member.organizationId, orgId),
		with: {
			user: {
				columns: {
					id: true,
					name: true,
					email: true,
					image: true,
				},
			},
		},
	});
}

export async function findMemberById(memberId: string, orgId: string): Promise<MemberRow | null> {
	const db = getDb();
	const result = await db.query.member.findFirst({
		where: and(eq(member.id, memberId), eq(member.organizationId, orgId)),
		with: {
			user: {
				columns: {
					id: true,
					name: true,
					email: true,
					image: true,
				},
			},
		},
	});

	return result ?? null;
}

export async function listInvitations(orgId: string): Promise<InvitationRow[]> {
	const db = getDb();
	const results = await db.query.invitation.findMany({
		where: and(
			eq(invitation.organizationId, orgId),
			eq(invitation.status, "pending"),
			gt(invitation.expiresAt, new Date()),
		),
		with: {
			inviter: {
				columns: {
					name: true,
					email: true,
				},
			},
		},
	});

	return results.map((result) => ({
		...result,
		inviter: result.inviter ?? null,
	}));
}

export async function getUserOrgIds(userId: string): Promise<string[]> {
	const db = getDb();
	const results = await db.query.member.findMany({
		where: eq(member.userId, userId),
		orderBy: [asc(member.createdAt), asc(member.organizationId)],
		columns: {
			organizationId: true,
		},
	});

	return results.map((result) => result.organizationId);
}

export async function findBasicInvitationInfo(invitationId: string): Promise<{
	email: string;
	status: string;
	expiresAt: Date;
	organizationName: string;
} | null> {
	const db = getDb();
	const result = await db.query.invitation.findFirst({
		where: eq(invitation.id, invitationId),
		columns: {
			email: true,
			status: true,
			expiresAt: true,
		},
		with: {
			organization: {
				columns: {
					name: true,
				},
			},
		},
	});

	if (!result) {
		return null;
	}

	return {
		email: result.email,
		status: result.status,
		expiresAt: result.expiresAt,
		organizationName: result.organization.name,
	};
}

export async function deletePersonalOrg(userId: string): Promise<boolean> {
	const db = getDb();
	const personalOrgId = `org_${userId}`;

	const org = await db.query.organization.findFirst({
		where: eq(organization.id, personalOrgId),
		columns: {
			id: true,
		},
	});

	if (!org) {
		return false;
	}

	const hasSession = await db.query.sessions.findFirst({
		where: eq(sessions.organizationId, personalOrgId),
		columns: {
			id: true,
		},
	});

	if (hasSession) {
		return false;
	}

	await db.transaction(async (tx) => {
		await tx
			.delete(member)
			.where(and(eq(member.organizationId, personalOrgId), eq(member.userId, userId)));
		await tx.delete(organization).where(eq(organization.id, personalOrgId));
	});

	return true;
}
