import * as reposDb from "./db";

export interface Repo {
	id: string;
	organizationId: string;
	githubOrg: string;
	githubName: string;
	githubRepoName: string;
	defaultBranch: string;
	defaultSnapshotId: string | null;
	connectionSource: string;
	createdAt: Date;
}

export interface RepoSnapshot {
	id: string;
	repoId: string;
	e2bSnapshotId: string;
	createdAt: Date;
	lastRefreshedAt: Date | null;
}

function toRepo(row: reposDb.RepoRow): Repo {
	return {
		id: row.id,
		organizationId: row.organizationId,
		githubOrg: row.githubOrg,
		githubName: row.githubName,
		githubRepoName: `${row.githubOrg}/${row.githubName}`,
		defaultBranch: row.defaultBranch,
		defaultSnapshotId: row.defaultSnapshotId ?? null,
		connectionSource: row.connectionSource,
		createdAt: row.createdAt,
	};
}

function toRepoSnapshot(row: reposDb.RepoSnapshotRow): RepoSnapshot {
	return {
		id: row.id,
		repoId: row.repoId,
		e2bSnapshotId: row.e2bSnapshotId,
		createdAt: row.createdAt,
		lastRefreshedAt: row.lastRefreshedAt ?? null,
	};
}

export async function listRepos(orgId: string): Promise<Repo[]> {
	const rows = await reposDb.listByOrg(orgId);
	return rows.map(toRepo);
}

export async function getRepo(id: string, orgId: string): Promise<Repo | null> {
	const row = await reposDb.findById(id);

	if (!row || row.organizationId !== orgId) {
		return null;
	}

	return toRepo(row);
}

export async function createRepo(
	orgId: string,
	data: { githubOrg: string; githubName: string; defaultBranch: string },
): Promise<Repo> {
	const row = await reposDb.create({
		organizationId: orgId,
		githubOrg: data.githubOrg,
		githubName: data.githubName,
		defaultBranch: data.defaultBranch,
	});

	return toRepo(row);
}

export async function deleteRepo(id: string, orgId: string): Promise<boolean> {
	const row = await reposDb.findById(id);

	if (!row || row.organizationId !== orgId) {
		return false;
	}

	return reposDb.deleteById(id);
}

export async function listSnapshots(repoId: string, orgId: string): Promise<RepoSnapshot[] | null> {
	const repo = await reposDb.findById(repoId);

	if (!repo || repo.organizationId !== orgId) {
		return null;
	}

	const rows = await reposDb.listSnapshots(repoId);
	return rows.map(toRepoSnapshot);
}
