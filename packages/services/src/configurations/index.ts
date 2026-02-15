/**
 * Configurations module exports.
 */

export * from "./service";
export * from "./mapper";

// Re-export types from db.ts (Drizzle types)
export type {
	ConfigurationRow,
	ConfigurationRepoRow,
	RepoBasicRow,
	ConfigurationForSessionRow,
	ConfigurationRepoDetailRow,
	ConfigurationSummaryRow,
	ConfigurationRepoWithConfigurationRow,
	SnapshotRepoRow,
	ConfigurationWithRelationsRow,
	ConfigurationWithOrgRow,
	ManagedConfigurationRow,
	RepoWithNameRow,
} from "./db";

// Re-export input types from types file
export type {
	CreateConfigurationInput as DbCreateConfigurationInput,
	CreateConfigurationRepoInput,
	UpdateConfigurationInput as DbUpdateConfigurationInput,
	CreateConfigurationFullInput,
	SnapshotRow,
} from "../types/configurations";

// DB functions needed by sessions-create and repos-finalize
export {
	findByIdForSession,
	getConfigurationReposWithDetails,
	getConfigurationServiceCommands,
	updateConfigurationServiceCommands,
	update as updateConfiguration,
	createFull as createConfigurationFull,
	configurationContainsRepo,
	createSingleConfigurationRepo,
} from "./db";

// DB functions needed by repos router (listConfigurations, listSnapshots)
export {
	listByRepoId,
	getConfigurationReposWithConfigurations,
	getReposForConfiguration,
} from "./db";

// Gateway-specific exports
export {
	findById,
	findByIdFull,
	findManagedConfigurations,
	getReposForManagedConfiguration,
	createManagedConfiguration,
	createConfigurationRepos,
	update,
} from "./db";
