import { type InferSelectModel, desc, eq, getDb } from "@proliferate/db";
import { repoSnapshots, repos } from "@proliferate/db/schema";

export type RepoRow = InferSelectModel<typeof repos>;
export type RepoSnapshotRow = InferSelectModel<typeof repoSnapshots>;

export async function listByOrg(orgId: string): Promise<RepoRow[]> {
	const db = getDb();
	return db.query.repos.findMany({
		where: eq(repos.organizationId, orgId),
		orderBy: [desc(repos.createdAt)],
	});
}

export async function findById(id: string): Promise<RepoRow | null> {
	const db = getDb();
	const result = await db.query.repos.findFirst({
		where: eq(repos.id, id),
	});

	return result ?? null;
}

export async function create(data: {
	organizationId: string;
	githubOrg: string;
	githubName: string;
	defaultBranch: string;
}): Promise<RepoRow> {
	const db = getDb();
	const [result] = await db.insert(repos).values(data).returning();
	return result;
}

export async function deleteById(id: string): Promise<boolean> {
	const db = getDb();
	const result = await db.delete(repos).where(eq(repos.id, id)).returning({ id: repos.id });
	return result.length > 0;
}

export async function listSnapshots(repoId: string): Promise<RepoSnapshotRow[]> {
	const db = getDb();
	return db.query.repoSnapshots.findMany({
		where: eq(repoSnapshots.repoId, repoId),
		orderBy: [desc(repoSnapshots.createdAt)],
	});
}
