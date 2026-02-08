/**
 * Prebuilds module exports.
 */

export * from "./service";
export * from "./mapper";

// Re-export types from db.ts (Drizzle types)
export type {
	PrebuildRow,
	PrebuildRepoRow,
	RepoBasicRow,
	PrebuildForSessionRow,
	PrebuildRepoDetailRow,
	RepoPrebuildRow,
	PrebuildRepoWithPrebuildRow,
	SnapshotRepoRow,
	PrebuildWithRelationsRow,
	PrebuildWithOrgRow,
	ManagedPrebuildRow,
	RepoWithNameRow,
} from "./db";

// Re-export input types from types file
export type {
	CreatePrebuildInput as DbCreatePrebuildInput,
	CreatePrebuildRepoInput,
	UpdatePrebuildInput as DbUpdatePrebuildInput,
	CreatePrebuildFullInput,
	SnapshotRow,
} from "../types/prebuilds";

// DB functions needed by sessions-create and repos-finalize
export {
	findByIdForSession,
	getPrebuildReposWithDetails,
	getPrebuildServiceCommands,
	updatePrebuildServiceCommands,
	updateSnapshotIdIfNull,
	update as updatePrebuild,
	createFull as createPrebuildFull,
	prebuildContainsRepo,
	createSinglePrebuildRepo,
} from "./db";

// DB functions needed by repos router (listPrebuilds, listSnapshots)
export { listByRepoId, getPrebuildReposWithPrebuilds, getReposForPrebuild } from "./db";

// Gateway-specific exports
export {
	findById,
	findByIdFull,
	findManagedPrebuilds,
	getReposForManagedPrebuild,
	createManagedPrebuild,
	createPrebuildRepos,
	update,
} from "./db";
