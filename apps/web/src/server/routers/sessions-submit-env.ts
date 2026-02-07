/**
 * Session environment submission handler.
 *
 * Submits secrets and environment variables to a running session.
 * Secrets are stored encrypted in the database, env vars are written to the sandbox.
 */

import { logger } from "@/lib/logger";
import { ORPCError } from "@orpc/server";
import { secrets, sessions } from "@proliferate/services";

const log = logger.child({ handler: "sessions-submit-env" });
import type { SandboxProviderType } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

interface SecretInput {
	key: string;
	value: string;
	description?: string;
}

interface EnvVarInput {
	key: string;
	value: string;
}

interface SubmitEnvHandlerInput {
	sessionId: string;
	orgId: string;
	userId: string;
	secrets: SecretInput[];
	envVars: EnvVarInput[];
	saveToPrebuild: boolean;
}

interface SubmitEnvResult {
	submitted: boolean;
}

export async function submitEnvHandler(input: SubmitEnvHandlerInput): Promise<SubmitEnvResult> {
	const { sessionId, orgId, userId, secrets: secretsInput, envVars, saveToPrebuild } = input;
	const startMs = Date.now();

	log.info(
		{
			sessionId,
			shortId: sessionId.slice(0, 8),
			envVarCount: envVars.length,
			secretCount: secretsInput.length,
			saveToPrebuild,
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

	// Add regular env vars
	for (const env of envVars) {
		envVarsMap[env.key] = env.value;
	}

	// Process secrets: add to env vars map and optionally save to database
	for (const secret of secretsInput) {
		envVarsMap[secret.key] = secret.value;

		// Save to database if requested
		if (saveToPrebuild) {
			try {
				await secrets.createSecret({
					organizationId: orgId,
					userId,
					key: secret.key,
					value: secret.value,
					description: secret.description,
					repoId: session.prebuildId ? undefined : undefined, // Secrets are org-scoped
					secretType: "secret",
				});
			} catch (err) {
				// Ignore duplicate errors - secret may already exist
				if (!(err instanceof secrets.DuplicateSecretError)) {
					log.error({ err, key: secret.key }, "Failed to save secret");
				}
			}
		}
	}

	// Write env vars to sandbox
	if (Object.keys(envVarsMap).length > 0) {
		try {
			const provider = getSandboxProvider(session.sandboxProvider as SandboxProviderType);
			const writeStartMs = Date.now();
			await provider.writeEnvFile(session.sandboxId, envVarsMap);
			log.info(
				{
					sessionId,
					shortId: sessionId.slice(0, 8),
					provider: provider.type,
					keyCount: Object.keys(envVarsMap).length,
					durationMs: Date.now() - writeStartMs,
				},
				"submit_env.write_env_file",
			);
		} catch (err) {
			log.error({ err }, "Failed to write env file to sandbox");
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: `Failed to write environment variables: ${err instanceof Error ? err.message : "Unknown error"}`,
			});
		}
	}

	log.info(
		{
			sessionId,
			shortId: sessionId.slice(0, 8),
			durationMs: Date.now() - startMs,
		},
		"submit_env.complete",
	);
	return { submitted: true };
}
