/**
 * CLI module exports.
 */

export * from "./service";
export type {
	CliGitHubSelectionRow,
	CliPrebuildRow,
	CliRepoConnectionRow,
	CliRepoRow,
	CliSessionFullRow,
	CliSessionRow,
	CreateCliSessionInput,
	CreateCliSessionWithPrebuildInput,
	DeviceCodeRow,
	GitHubIntegrationForTokenRow,
	GitHubIntegrationStatusRow,
	SshKeyRow,
	SshKeyWithPublicKey,
} from "../types/cli";

// Gateway-specific exports (DB functions not in service.ts)
export {
	getCliPrebuild,
	createCliPrebuildPending,
	findLocalRepo,
	createLocalRepo,
	upsertPrebuildRepo,
} from "./db";
