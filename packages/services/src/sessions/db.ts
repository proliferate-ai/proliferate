import { desc, eq, getDb, type InferSelectModel } from "@proliferate/db";
import { sessions } from "@proliferate/db/schema";

export type SessionRow = InferSelectModel<typeof sessions>;

export interface SessionWithRepo extends SessionRow {
	repo: { githubOrg: string; githubName: string } | null;
}

export async function listByOrg(orgId: string): Promise<SessionWithRepo[]> {
	const db = getDb();
	const results = await db.query.sessions.findMany({
		where: eq(sessions.organizationId, orgId),
		orderBy: [desc(sessions.createdAt)],
		with: {
			repo: {
				columns: {
					githubOrg: true,
					githubName: true,
				},
			},
		},
	});

	return results.map((r) => ({
		...r,
		repo: r.repo ?? null,
	}));
}

export async function findById(id: string): Promise<SessionWithRepo | null> {
	const db = getDb();
	const result = await db.query.sessions.findFirst({
		where: eq(sessions.id, id),
		with: {
			repo: {
				columns: {
					githubOrg: true,
					githubName: true,
				},
			},
		},
	});

	if (!result) return null;

	return {
		...result,
		repo: result.repo ?? null,
	};
}
