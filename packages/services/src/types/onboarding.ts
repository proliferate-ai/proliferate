/**
 * Onboarding module types.
 *
 * DB row shapes for onboarding queries.
 * Uses camelCase to match Drizzle schema.
 */

// ============================================
// DB Row Types
// ============================================

export interface RepoWithPrebuildRow {
	id: string;
	githubRepoName: string;
	githubUrl: string;
	defaultBranch: string | null;
	createdAt: Date | null;
	repoSnapshotStatus: string | null;
	prebuildRepos: Array<{
		prebuild: {
			id: string;
			status: string | null;
			snapshotId: string | null;
		} | null;
	}>;
}

export interface SlackInstallationRow {
	id: string;
}

export interface IntegrationRow {
	id: string;
	githubInstallationId: string | null;
	connectionId: string | null;
	provider: string | null;
}
