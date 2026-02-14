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
import { prebuilds, repos, secrets, sessions, snapshots } from "@proliferate/services";
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
	prebuildId: string;
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

	// 1. Get session and verify it belongs to this repo or prebuild
	const session = await sessions.findSessionByIdInternal(sessionId);

	if (!session) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found" });
	}

	// Verify repoId matches or session's prebuild contains this repo
	const sessionBelongsToRepo = session.repoId === repoId;
	let sessionBelongsToPrebuild = false;

	if (session.prebuildId && !sessionBelongsToRepo) {
		sessionBelongsToPrebuild = await prebuilds.prebuildContainsRepo(session.prebuildId, repoId);
	}

	if (!sessionBelongsToRepo && !sessionBelongsToPrebuild) {
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

	let prebuildId: string;

	// Determine which prebuild to update
	const existingPrebuildId = updateSnapshotId || session.prebuildId;

	if (existingPrebuildId) {
		// Update existing prebuild record
		prebuildId = existingPrebuildId;
		try {
			await prebuilds.updatePrebuild(existingPrebuildId, {
				snapshotId,
				status: "ready",
				name: name || null,
				notes: notes || null,
			});
		} catch {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to update prebuild" });
		}
	} else {
		// Create new prebuild record
		prebuildId = randomUUID();
		try {
			await prebuilds.createPrebuildFull({
				id: prebuildId,
				organizationId,
				snapshotId,
				status: "ready",
				name: name || null,
				notes: notes || null,
				createdBy: userId,
				sandboxProvider: provider.type,
			});
		} catch {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create prebuild" });
		}

		// Create prebuild_repos entry for this repo
		const repoName = repoId.slice(0, 8);
		const githubRepoName = await repos.getGithubRepoName(repoId);
		const workspacePath = githubRepoName?.split("/")[1] || repoName;

		await prebuilds.createSinglePrebuildRepo(prebuildId, repoId, workspacePath);

		// Update session with the new prebuild_id
		await sessions.updateSessionPrebuildId(sessionId, prebuildId);
	}

	// Dual-write: create snapshot in new snapshots table
	try {
		const snapshotRecord = await snapshots.createSnapshot({
			prebuildId,
			sandboxProvider: provider.type,
		});
		await snapshots.markSnapshotReady({
			snapshotId: snapshotRecord.id,
			providerSnapshotId: snapshotId,
			hasDeps: true,
			repoCommits: [],
		});
	} catch (err) {
		log.warn({ err }, "Failed to dual-write snapshot to new table (non-fatal)");
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
		prebuildId,
		snapshotId,
		success: true,
	};
}
