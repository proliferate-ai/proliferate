/**
 * Session environment submission service.
 *
 * Submits secrets and environment variables to a running session.
 * Secrets are stored encrypted in the database, env vars are written to the sandbox.
 *
 * Persistence semantics:
 * - Each secret can individually opt into org-level persistence via `persist`.
 * - If `persist` is absent, the global `saveToConfiguration` flag is used as fallback.
 * - Regular env vars are always session-only (never persisted to DB).
 * - All values (persisted or not) are written to the sandbox for the current session.
 */

import type { SandboxProviderType } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import { getServicesLogger } from "../logger";
import * as secrets from "../secrets";
import { SessionInvalidStateError, SessionNotFoundError } from "./pause";
import { getFullSession } from "./service";

export interface SecretInput {
	key: string;
	value: string;
	description?: string;
	persist?: boolean;
}

export interface EnvVarInput {
	key: string;
	value: string;
}

export interface SubmitEnvInput {
	sessionId: string;
	orgId: string;
	userId: string;
	secrets: SecretInput[];
	envVars: EnvVarInput[];
	saveToConfiguration: boolean;
}

export interface SecretResult {
	key: string;
	persisted: boolean;
	alreadyExisted: boolean;
}

export interface SubmitEnvResult {
	submitted: boolean;
	results: SecretResult[];
}

export async function submitEnv(input: SubmitEnvInput): Promise<SubmitEnvResult> {
	const { sessionId, orgId, userId, secrets: secretsInput, envVars, saveToConfiguration } = input;
	const log = getServicesLogger().child({ module: "sessions/submit-env", sessionId });
	const startMs = Date.now();

	log.info(
		{
			envVarCount: envVars.length,
			secretCount: secretsInput.length,
			persistCount: secretsInput.filter((s) => s.persist ?? saveToConfiguration).length,
			saveToConfiguration,
		},
		"submit_env.start",
	);

	const session = await getFullSession(sessionId, orgId);

	if (!session) {
		throw new SessionNotFoundError(sessionId);
	}

	if (!session.sandboxId) {
		throw new SessionInvalidStateError("Session has no active sandbox");
	}

	const envVarsMap: Record<string, string> = {};

	for (const env of envVars) {
		envVarsMap[env.key] = env.value;
	}

	const results: SecretResult[] = [];

	for (const secret of secretsInput) {
		envVarsMap[secret.key] = secret.value;
		const shouldPersist = secret.persist ?? saveToConfiguration;

		if (shouldPersist) {
			try {
				await secrets.createSecret({
					organizationId: orgId,
					userId,
					key: secret.key,
					value: secret.value,
					description: secret.description,
					secretType: "secret",
				});
				results.push({ key: secret.key, persisted: true, alreadyExisted: false });
			} catch (err) {
				if (err instanceof secrets.DuplicateSecretError) {
					results.push({ key: secret.key, persisted: false, alreadyExisted: true });
				} else {
					log.error({ err, key: secret.key }, "Failed to save secret");
					results.push({ key: secret.key, persisted: false, alreadyExisted: false });
				}
			}
		} else {
			results.push({ key: secret.key, persisted: false, alreadyExisted: false });
		}
	}

	if (Object.keys(envVarsMap).length > 0) {
		try {
			const provider = getSandboxProvider(session.sandboxProvider as SandboxProviderType);
			const writeStartMs = Date.now();
			await provider.writeEnvFile(session.sandboxId, envVarsMap);
			log.info(
				{
					provider: provider.type,
					keyCount: Object.keys(envVarsMap).length,
					durationMs: Date.now() - writeStartMs,
				},
				"submit_env.write_env_file",
			);
		} catch (err) {
			log.error({ err }, "Failed to write env file to sandbox");
			throw new Error(
				`Failed to write environment variables: ${err instanceof Error ? err.message : "Unknown error"}`,
			);
		}
	}

	log.info(
		{
			durationMs: Date.now() - startMs,
			persistedCount: results.filter((r) => r.persisted).length,
			duplicateCount: results.filter((r) => r.alreadyExisted).length,
		},
		"submit_env.complete",
	);

	return { submitted: true, results };
}
