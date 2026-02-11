/**
 * Secrets module exports.
 */

export * from "./service";
export * from "./mapper";
export type {
	SecretRow,
	SecretListRow,
	DbCreateSecretInput,
	SecretForSessionRow,
	UpsertSecretInput,
	CheckSecretsFilter,
	SecretBundleListRow,
	DbCreateBundleInput,
	DbUpdateBundleInput,
} from "../types/secrets";
export {
	EncryptionError,
	DuplicateSecretError,
	DuplicateBundleError,
	BundleNotFoundError,
} from "./service";

// DB functions needed by sessions-create and repos-finalize
export { getSecretsForSession, upsertByRepoAndKey as upsertSecretByRepoAndKey } from "./db";
