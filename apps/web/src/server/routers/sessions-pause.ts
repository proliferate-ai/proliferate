/**
 * Session pause handler.
 *
 * Takes a snapshot and terminates the sandbox.
 * Extracted from ts-rest router for use in oRPC.
 */

import { logger } from "@/lib/logger";
import { ORPCError } from "@orpc/server";
import { billing, orgs, sessions } from "@proliferate/services";
import type { SandboxProviderType } from "@proliferate/shared";
import type { BillingPlan } from "@proliferate/shared/billing";
import { revokeVirtualKey } from "@proliferate/shared/llm-proxy";
import { getSandboxProvider } from "@proliferate/shared/providers";

const log = logger.child({ handler: "sessions-pause" });

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

	// Ensure snapshot quota before taking a new snapshot
	const org = await orgs.getBillingInfoV2(orgId);
	const plan: BillingPlan = org?.billingPlan === "pro" ? "pro" : "dev";
	const provider = getSandboxProvider(session.sandboxProvider as SandboxProviderType);

	const capacity = await billing.ensureSnapshotCapacity(orgId, plan);

	let snapshotId: string | null = null;

	if (capacity.allowed) {
		// Take snapshot before terminating
		try {
			const snapshotResult = await provider.snapshot(sessionId, session.sandboxId);
			snapshotId = snapshotResult.snapshotId;
		} catch (err) {
			reqLog.error({ err }, "Snapshot error, pausing without snapshot");
		}
	} else {
		reqLog.warn("Snapshot quota exceeded, pausing without snapshot");
	}

	// Always terminate sandbox
	try {
		await provider.terminate(sessionId, session.sandboxId);

		// Best-effort key revocation (fire-and-forget)
		revokeVirtualKey(sessionId).catch((err) => {
			reqLog.debug({ err }, "Failed to revoke virtual key");
		});
	} catch (err) {
		reqLog.error({ err }, "Failed to terminate sandbox");
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
