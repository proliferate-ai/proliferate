import * as secretsDb from "./db";
import * as reposDb from "../repos/db";

export interface RepoBinding {
	id: string;
	repoId: string;
}

export interface Secret {
	id: string;
	organizationId: string;
	key: string;
	createdAt: Date;
	updatedAt: Date;
	repoBindings: RepoBinding[];
}

function toSecret(row: Awaited<ReturnType<typeof secretsDb.listByOrg>>[number]): Secret {
	return {
		id: row.id,
		organizationId: row.organizationId,
		key: row.key,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		repoBindings: row.repoBindings.map((b) => ({
			id: b.id,
			repoId: b.repoId,
		})),
	};
}

export async function listSecrets(orgId: string): Promise<Secret[]> {
	const rows = await secretsDb.listByOrg(orgId);
	return rows.map(toSecret);
}

export async function getSecret(id: string, orgId: string): Promise<Secret | null> {
	const row = await secretsDb.findById(id);
	if (!row || row.organizationId !== orgId) return null;
	// Return without bindings for single get
	return {
		id: row.id,
		organizationId: row.organizationId,
		key: row.key,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		repoBindings: [],
	};
}

export async function createSecret(orgId: string, key: string, encryptedValue: string): Promise<Secret> {
	const row = await secretsDb.create({ organizationId: orgId, key, encryptedValue });
	return {
		id: row.id,
		organizationId: row.organizationId,
		key: row.key,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		repoBindings: [],
	};
}

export async function deleteSecret(id: string, orgId: string): Promise<boolean> {
	const row = await secretsDb.findById(id);
	if (!row || row.organizationId !== orgId) return false;
	return secretsDb.deleteById(id);
}

export async function updateSecretValue(id: string, orgId: string, encryptedValue: string): Promise<boolean> {
	const row = await secretsDb.findById(id);
	if (!row || row.organizationId !== orgId) return false;
	return secretsDb.updateValue(id, encryptedValue);
}

export async function addRepoBinding(secretId: string, repoId: string, orgId: string): Promise<boolean> {
	const secret = await secretsDb.findById(secretId);
	const repo = await reposDb.findById(repoId);

	if (!secret || secret.organizationId !== orgId) return false;
	if (!repo || repo.organizationId !== orgId) return false;

	return secretsDb.addRepoBinding(secretId, repoId);
}

export async function removeRepoBinding(secretId: string, repoId: string, orgId: string): Promise<boolean> {
	const secret = await secretsDb.findById(secretId);
	const repo = await reposDb.findById(repoId);

	if (!secret || secret.organizationId !== orgId) return false;
	if (!repo || repo.organizationId !== orgId) return false;

	return secretsDb.removeRepoBinding(secretId, repoId);
}
