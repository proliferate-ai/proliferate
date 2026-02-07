/**
 * Session pause handler.
 *
 * Takes a snapshot and terminates the sandbox.
 * Extracted from ts-rest router for use in oRPC.
 */

import { logger } from "@/lib/logger";
import { ORPCError } from "@orpc/server";
import { billing, sessions } from "@proliferate/services";

const log = logger.child({ handler: "sessions-pause" });
import type { SandboxProviderType } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

interface PauseSessionHandlerInput {
	sessionId: string;
	orgId: string;
}

interface PauseSessionResult {
	paused: boolean;
	snapshotId: string | null;
}

export async function pauseSessionHandler(
	input: PauseSessionHandlerInput,
): Promise<PauseSessionResult> {
	const { sessionId, orgId } = input;
	const reqLog = log.child({ sessionId });

	// Get full session data
	const session = await sessions.getFullSession(sessionId, orgId);

	if (!session) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found" });
	}

	// Must be running to pause
	if (session.status !== "running") {
		throw new ORPCError("BAD_REQUEST", {
			message: `Cannot pause session with status '${session.status}'`,
		});
	}

	// Must have a sandbox to snapshot
	if (!session.sandboxId) {
		throw new ORPCError("BAD_REQUEST", { message: "Session has no active sandbox" });
	}

	let snapshotId: string | null = null;

	// Take snapshot before terminating
	try {
		const provider = getSandboxProvider(session.sandboxProvider as SandboxProviderType);

		// Snapshot the sandbox
		const snapshotResult = await provider.snapshot(sessionId, session.sandboxId);
		snapshotId = snapshotResult.snapshotId;

		// Terminate sandbox after successful snapshot
		try {
			await provider.terminate(sessionId, session.sandboxId);
		} catch (err) {
			reqLog.error({ err }, "Failed to terminate sandbox");
		}
	} catch (err) {
		reqLog.error({ err }, "Snapshot error");
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: `Failed to snapshot session: ${err instanceof Error ? err.message : "Unknown error"}. Session kept running.`,
		});
	}

	// Finalize compute billing before changing status
	try {
		await billing.finalizeSessionBilling(sessionId);
	} catch (err) {
		reqLog.error({ err }, "Failed to finalize billing");
	}

	// Update session record
	try {
		await sessions.updateSession(sessionId, {
			status: "paused",
			snapshotId,
			sandboxId: null,
			openCodeTunnelUrl: null,
			previewTunnelUrl: null,
			codingAgentSessionId: null,
			pausedAt: new Date().toISOString(),
		});
	} catch (updateError) {
		reqLog.error({ err: updateError }, "Failed to update session");
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to update session" });
	}

	return {
		paused: true,
		snapshotId,
	};
}
