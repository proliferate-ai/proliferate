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
} from "../types/secrets";
export { EncryptionError, DuplicateSecretError } from "./service";

// DB functions needed by sessions-create and repos-finalize
export { getSecretsForSession, upsertByRepoAndKey as upsertSecretByRepoAndKey } from "./db";
