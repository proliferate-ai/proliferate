/**
 * Finalize setup handler - extracted from configurations router.
 *
 * This is a complex operation with many side effects.
 * Uses services layer for all database operations.
 */

import { randomUUID } from "crypto";
import { encrypt, getEncryptionKey } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { ORPCError } from "@orpc/server";
import { configurations, repos, secrets, sessions } from "@proliferate/services";
import type { SandboxProviderType } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

const log = logger.child({ handler: "configurations-finalize" });

export interface FinalizeSetupInput {
	repoId?: string;
	sessionId: string;
	secrets?: Record<string, string>;
	name?: string;
	notes?: string;
	updateSnapshotId?: string;
	keepRunning?: boolean;
	userId: string;
	orgId: string;
}

export interface FinalizeSetupResult {
	configurationId: string;
	snapshotId: string;
	success: boolean;
}

/**
 * Resolve the target repoId for finalization.
 *
 * Decision tree (per advisor brief §9 Phase 4):
 * 1. If caller supplied repoId: use it.
 * 2. Else if session.repoId is non-null: use it.
 * 3. Else if session.configurationId is null: reject.
 * 4. Else load configurationRepos:
 *    - Exactly one repo: use that repo.
 *    - Multiple repos + secrets payload non-empty: reject (ambiguous).
 *    - Multiple repos + no secrets: return the first repo (secrets skipped by caller).
 *    - Zero repos: reject.
 */
async function resolveRepoId(
	explicitRepoId: string | undefined,
	session: { repoId: string | null; configurationId: string | null },
	hasSecrets: boolean,
): Promise<string> {
	if (explicitRepoId) return explicitRepoId;
	if (session.repoId) return session.repoId;
	if (!session.configurationId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "repoId is required when session has no configuration",
		});
	}

	const configRepos = await configurations.getConfigurationReposWithDetails(
		session.configurationId,
	);
	const repoIds = configRepos.map((cr) => cr.repo?.id).filter(Boolean) as string[];
	if (repoIds.length === 0) {
		throw new ORPCError("BAD_REQUEST", { message: "Configuration has no repos" });
	}
	if (repoIds.length === 1) {
		return repoIds[0];
	}
	// Multiple repos
	if (hasSecrets) {
		throw new ORPCError("BAD_REQUEST", {
			message: "repoId required for multi-repo secret persistence",
		});
	}
	return repoIds[0];
}

export async function finalizeSetupHandler(
	input: FinalizeSetupInput,
): Promise<FinalizeSetupResult> {
	const {
		repoId: explicitRepoId,
		sessionId,
		secrets: inputSecrets = {},
		name,
		notes,
		updateSnapshotId,
		keepRunning = true,
		userId,
		orgId,
	} = input;

	if (!sessionId) {
		throw new ORPCError("BAD_REQUEST", { message: "sessionId is required" });
	}

	// 1. Get session
	const session = await sessions.findSessionByIdInternal(sessionId);

	if (!session) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found" });
	}

	if (session.organizationId !== orgId) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found" });
	}

	if (session.sessionType !== "setup") {
		throw new ORPCError("BAD_REQUEST", { message: "Only setup sessions can be finalized" });
	}

	const sandboxId = session.sandboxId;
	if (!sandboxId) {
		throw new ORPCError("BAD_REQUEST", { message: "No sandbox associated with session" });
	}

	// 2. Resolve repoId (may be derived from session/configuration)
	const repoId = await resolveRepoId(
		explicitRepoId,
		{ repoId: session.repoId, configurationId: session.configurationId },
		Object.keys(inputSecrets).length > 0,
	);

	// Verify repoId matches session or session's configuration contains this repo
	const sessionBelongsToRepo = session.repoId === repoId;
	let sessionBelongsToConfiguration = false;

	if (session.configurationId && !sessionBelongsToRepo) {
		sessionBelongsToConfiguration = await configurations.configurationContainsRepo(
			session.configurationId,
			repoId,
		);
	}

	if (!sessionBelongsToRepo && !sessionBelongsToConfiguration) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found for this repo" });
	}

	// 3. Take filesystem snapshot via provider
	const provider = getSandboxProvider(session.sandboxProvider as SandboxProviderType);
	let snapshotId: string | null = null;

	try {
		const snapshotResult = await provider.snapshot(sessionId, sandboxId);
		snapshotId = snapshotResult.snapshotId;
	} catch (err) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: `Failed to create snapshot: ${err instanceof Error ? err.message : "Unknown error"}`,
		});
	}

	// Get the repo to find organization_id
	const organizationId = await repos.getOrganizationId(repoId);

	if (!organizationId) {
		throw new ORPCError("NOT_FOUND", { message: "Repo not found" });
	}

	// 4. Encrypt and store secrets
	if (Object.keys(inputSecrets).length > 0) {
		try {
			const encryptionKey = getEncryptionKey();

			for (const [key, value] of Object.entries(inputSecrets)) {
				const encryptedValue = encrypt(value, encryptionKey);

				const stored = await secrets.upsertSecretByRepoAndKey({
					repoId,
					organizationId,
					key,
					encryptedValue,
				});
				if (!stored) {
					throw new Error(`Failed to store secret key: ${key}`);
				}
			}
		} catch (err) {
			log.error({ err, repoId }, "Failed to store setup secrets");
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: err instanceof Error ? err.message : "Failed to store secrets",
				cause: err,
			});
		}
	}

	if (!snapshotId) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create snapshot" });
	}

	let configurationId: string;

	// Determine which configuration to update
	const existingConfigurationId = updateSnapshotId || session.configurationId;

	if (existingConfigurationId) {
		// Update existing configuration record
		configurationId = existingConfigurationId;
		try {
			await configurations.updateConfiguration(existingConfigurationId, {
				snapshotId,
				status: "ready",
				name: name || null,
				notes: notes || null,
			});
		} catch {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to update configuration" });
		}
	} else {
		// Create new configuration record
		configurationId = randomUUID();
		try {
			await configurations.createConfigurationFull({
				id: configurationId,
				snapshotId,
				status: "ready",
				name: name || null,
				notes: notes || null,
				createdBy: userId,
				sandboxProvider: provider.type,
			});
		} catch {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create configuration" });
		}

		// Create configuration_repos entry for this repo
		const repoName = repoId.slice(0, 8);
		const githubRepoName = await repos.getGithubRepoName(repoId);
		const workspacePath = githubRepoName?.split("/")[1] || repoName;

		await configurations.createSingleConfigurationRepo(configurationId, repoId, workspacePath);

		// Update session with the new configuration_id
		await sessions.updateSessionConfigurationId(sessionId, configurationId);
	}

	// 7. Terminate sandbox and end session (unless keepRunning)
	if (!keepRunning) {
		try {
			await provider.terminate(sessionId, sandboxId);
		} catch (err) {
			log.warn({ err, sessionId, sandboxId }, "Failed to terminate sandbox");
		}

		await sessions.markSessionStopped(sessionId);
	}

	return {
		configurationId,
		snapshotId,
		success: true,
	};
}
