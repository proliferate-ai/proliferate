/**
 * Session environment submission handler.
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

import { logger } from "@/lib/logger";
import { ORPCError } from "@orpc/server";
import { secrets, sessions } from "@proliferate/services";

const log = logger.child({ handler: "sessions-submit-env" });
import type { SandboxProviderType } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

// ============================================
// Types
// ============================================

export interface SecretInput {
	key: string;
	value: string;
	description?: string;
	persist?: boolean;
}

interface EnvVarInput {
	key: string;
	value: string;
}

export interface SubmitEnvHandlerInput {
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

// ============================================
// Handler
// ============================================

export async function submitEnvHandler(input: SubmitEnvHandlerInput): Promise<SubmitEnvResult> {
	const { sessionId, orgId, userId, secrets: secretsInput, envVars, saveToConfiguration } = input;
	const reqLog = log.child({ sessionId });
	const startMs = Date.now();

	reqLog.info(
		{
			envVarCount: envVars.length,
			secretCount: secretsInput.length,
			persistCount: secretsInput.filter((s) => s.persist ?? saveToConfiguration).length,
			saveToConfiguration,
		},
		"submit_env.start",
	);

	// Get full session data to find sandbox
	const session = await sessions.getFullSession(sessionId, orgId);

	if (!session) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found" });
	}

	if (!session.sandboxId) {
		throw new ORPCError("BAD_REQUEST", { message: "Session has no active sandbox" });
	}

	// Build env vars map to write to sandbox
	const envVarsMap: Record<string, string> = {};

	// Add regular env vars (always session-only)
	for (const env of envVars) {
		envVarsMap[env.key] = env.value;
	}

	// Process secrets: add to env vars map and optionally save to database
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
					reqLog.error({ err, key: secret.key }, "Failed to save secret");
					results.push({ key: secret.key, persisted: false, alreadyExisted: false });
				}
			}
		} else {
			results.push({ key: secret.key, persisted: false, alreadyExisted: false });
		}
	}

	// Write env vars to sandbox
	if (Object.keys(envVarsMap).length > 0) {
		try {
			const provider = getSandboxProvider(session.sandboxProvider as SandboxProviderType);
			const writeStartMs = Date.now();
			await provider.writeEnvFile(session.sandboxId, envVarsMap);
			reqLog.info(
				{
					provider: provider.type,
					keyCount: Object.keys(envVarsMap).length,
					durationMs: Date.now() - writeStartMs,
				},
				"submit_env.write_env_file",
			);
		} catch (err) {
			reqLog.error({ err }, "Failed to write env file to sandbox");
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: `Failed to write environment variables: ${err instanceof Error ? err.message : "Unknown error"}`,
			});
		}
	}

	reqLog.info(
		{
			durationMs: Date.now() - startMs,
			persistedCount: results.filter((r) => r.persisted).length,
			duplicateCount: results.filter((r) => r.alreadyExisted).length,
		},
		"submit_env.complete",
	);
	return { submitted: true, results };
}
