/**
 * Repos module types.
 *
 * DB row shapes and input types for repos operations.
 */

import type { Repo } from "@proliferate/shared";

// ============================================
// DB Row Types (re-exported from db.ts)
// ============================================

// RepoRow and RepoWithConfigurationsRow are now exported from repos/db.ts
// using InferSelectModel<typeof repos> for type safety

// ============================================
// DB Input Types
// ============================================

export interface DbCreateRepoInput {
	id: string;
	organizationId: string;
	githubRepoId: string;
	githubRepoName: string;
	githubUrl: string;
	defaultBranch?: string;
	addedBy: string;
	isPrivate?: boolean;
	source?: string;
}

// ============================================
// Service Input/Output Types
// ============================================

export interface CreateRepoInput {
	organizationId: string;
	userId: string;
	githubRepoId: string;
	githubUrl: string;
	githubRepoName: string;
	defaultBranch?: string;
	integrationId?: string;
	isPrivate?: boolean;
	source?: string;
}

export interface CreateRepoResult {
	id: string;
	repo: Partial<Repo>;
	existing: boolean;
}
