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

// DB functions needed by routers (getSecretsForBoot is exported from service.ts above)
export { listByConfiguration } from "./db";
