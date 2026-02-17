/**
 * CLI module exports.
 */

export * from "./service";
export type {
	CliGitHubSelectionRow,
	CliConfigurationRow,
	CliRepoConnectionRow,
	CliRepoRow,
	CliSessionFullRow,
	CliSessionRow,
	CreateCliSessionInput,
	CreateCliSessionWithConfigurationInput,
	DeviceCodeRow,
	GitHubIntegrationForTokenRow,
	GitHubIntegrationStatusRow,
	SshKeyRow,
	SshKeyWithPublicKey,
} from "../types/cli";

// Gateway-specific exports (DB functions not in service.ts)
export {
	getCliConfiguration,
	createCliConfigurationPending,
	findLocalRepo,
	createLocalRepo,
	upsertConfigurationRepo,
} from "./db";
