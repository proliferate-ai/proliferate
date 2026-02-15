/**
 * Onboarding module types.
 *
 * DB row shapes for onboarding queries.
 * Uses camelCase to match Drizzle schema.
 */

// ============================================
// DB Row Types
// ============================================

export interface RepoWithConfigurationRow {
	id: string;
	githubRepoName: string;
	githubUrl: string;
	defaultBranch: string | null;
	createdAt: Date | null;
	configurationRepos: Array<{
		configuration: {
			id: string;
			activeSnapshotId: string | null;
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
