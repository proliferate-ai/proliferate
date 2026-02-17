/**
 * Finalize setup handler - extracted from repos router.
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

const log = logger.child({ handler: "repos-finalize" });

export interface FinalizeSetupInput {
	repoId: string;
	sessionId: string;
	secrets?: Record<string, string>;
	name?: string;
	notes?: string;
	updateSnapshotId?: string;
	keepRunning?: boolean;
	userId: string;
}

export interface FinalizeSetupResult {
	configurationId: string;
	snapshotId: string;
	success: boolean;
}

export async function finalizeSetupHandler(
	input: FinalizeSetupInput,
): Promise<FinalizeSetupResult> {
	const {
		repoId,
		sessionId,
		secrets: inputSecrets = {},
		name,
		notes,
		updateSnapshotId,
		keepRunning = true,
		userId,
	} = input;

	if (!sessionId) {
		throw new ORPCError("BAD_REQUEST", { message: "sessionId is required" });
	}

	// 1. Get session and verify it belongs to this repo or configuration
	const session = await sessions.findSessionByIdInternal(sessionId);

	if (!session) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found" });
	}

	// Verify repoId matches or session's configuration contains this repo
	const sessionBelongsToRepo = session.repoId === repoId;
	let sessionBelongsToConfiguration = false;

	if (session.configurationId && !sessionBelongsToRepo) {
		sessionBelongsToConfiguration = await configurations.configurationContainsRepo(session.configurationId, repoId);
	}

	if (!sessionBelongsToRepo && !sessionBelongsToConfiguration) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found for this repo" });
	}

	if (session.sessionType !== "setup") {
		throw new ORPCError("BAD_REQUEST", { message: "Only setup sessions can be finalized" });
	}

	const sandboxId = session.sandboxId;
	if (!sandboxId) {
		throw new ORPCError("BAD_REQUEST", { message: "No sandbox associated with session" });
	}

	// 2. Take filesystem snapshot via provider
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

				await secrets.upsertSecretByRepoAndKey({
					repoId,
					organizationId,
					key,
					encryptedValue,
				});
			}
		} catch (err) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to store secrets" });
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
