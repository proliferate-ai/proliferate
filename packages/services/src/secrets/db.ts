import {
	and,
	eq,
	getDb,
	type InferSelectModel,
	desc,
} from "@proliferate/db";
import { repoSecrets, repos, secrets } from "@proliferate/db/schema";

export type SecretRow = InferSelectModel<typeof secrets>;
export type RepoSecretRow = InferSelectModel<typeof repoSecrets>;

export async function listByOrg(orgId: string): Promise<
	(SecretRow & { repoBindings: (RepoSecretRow & { repo: { id: string; githubOrg: string; githubName: string } })[] })[]
> {
	const db = getDb();
	return db.query.secrets.findMany({
		where: eq(secrets.organizationId, orgId),
		orderBy: [desc(secrets.createdAt)],
		with: {
			repoBindings: {
				with: {
					repo: {
						columns: {
							id: true,
							githubOrg: true,
							githubName: true,
						},
					},
				},
			},
		},
	});
}

export async function findById(id: string): Promise<SecretRow | null> {
	const db = getDb();
	const result = await db.query.secrets.findFirst({
		where: eq(secrets.id, id),
	});
	return result ?? null;
}

export async function create(data: {
	organizationId: string;
	key: string;
	encryptedValue: string;
}): Promise<SecretRow> {
	const db = getDb();
	const [result] = await db.insert(secrets).values(data).returning();
	return result;
}

export async function deleteById(id: string): Promise<boolean> {
	const db = getDb();
	const result = await db.delete(secrets).where(eq(secrets.id, id)).returning({ id: secrets.id });
	return result.length > 0;
}

export async function updateValue(id: string, encryptedValue: string): Promise<boolean> {
	const db = getDb();
	const result = await db
		.update(secrets)
		.set({ encryptedValue, updatedAt: new Date() })
		.where(eq(secrets.id, id))
		.returning({ id: secrets.id });
	return result.length > 0;
}

export async function addRepoBinding(secretId: string, repoId: string): Promise<boolean> {
	const db = getDb();
	try {
		await db.insert(repoSecrets).values({ secretId, repoId });
		return true;
	} catch {
		return false;
	}
}

export async function removeRepoBinding(secretId: string, repoId: string): Promise<boolean> {
	const db = getDb();
	const result = await db
		.delete(repoSecrets)
		.where(and(eq(repoSecrets.secretId, secretId), eq(repoSecrets.repoId, repoId)))
		.returning({ id: repoSecrets.id });
	return result.length > 0;
}
