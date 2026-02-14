/**
 * Secret Files module exports.
 */

export * from "./service";

// Re-export DB types
export type {
	SecretFileRow,
	ConfigurationSecretRow,
	SecretFileWithKeysRow,
	SecretForBootRow,
} from "./db";

// DB functions needed by gateway
export { getSecretsForBoot, saveEnvFileSpec, listByPrebuild } from "./db";
