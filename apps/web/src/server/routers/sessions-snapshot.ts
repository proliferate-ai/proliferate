/**
 * Session snapshot handler.
 *
 * Creates a snapshot of the session's current state.
 * Extracted from ts-rest router for use in oRPC.
 */

import { logger } from "@/lib/logger";
import { ORPCError } from "@orpc/server";
import { billing, orgs, sessions } from "@proliferate/services";
import type { SandboxProviderType } from "@proliferate/shared";
import type { BillingPlan } from "@proliferate/shared/billing";
import { getSandboxProvider } from "@proliferate/shared/providers";

const log = logger.child({ handler: "sessions-snapshot" });

interface SnapshotSessionHandlerInput {
	sessionId: string;
	orgId: string;
}

interface SnapshotSessionResult {
	snapshot_id: string;
}

export async function snapshotSessionHandler(
	input: SnapshotSessionHandlerInput,
): Promise<SnapshotSessionResult> {
	const { sessionId, orgId } = input;
	const reqLog = log.child({ sessionId });

	// Get full session data
	const session = await sessions.getFullSession(sessionId, orgId);

	if (!session) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found" });
	}

	if (!session.sandboxId) {
		throw new ORPCError("BAD_REQUEST", { message: "Session has no sandbox" });
	}

	// Ensure snapshot quota before taking a new snapshot
	const org = await orgs.getBillingInfoV2(orgId);
	const plan: BillingPlan = org?.billingPlan === "pro" ? "pro" : "dev";

	const capacity = await billing.ensureSnapshotCapacity(
		orgId,
		plan,
		billing.deleteSnapshotFromProvider,
	);
	if (!capacity.allowed) {
		throw new ORPCError("CONFLICT", {
			message: "Snapshot quota exceeded. Delete an existing snapshot and try again.",
		});
	}

	// Take snapshot via provider
	try {
		const startTime = Date.now();
		reqLog.info("Snapshot started");

		const providerType = session.sandboxProvider as SandboxProviderType | undefined;
		const provider = getSandboxProvider(providerType);
		const result = await provider.snapshot(sessionId, session.sandboxId);
		const providerMs = Date.now() - startTime;
		reqLog.info({ providerMs, providerType: provider.type }, "Provider snapshot complete");

		// Update session with snapshot_id
		await sessions.updateSession(sessionId, { snapshotId: result.snapshotId });
		const totalMs = Date.now() - startTime;
		reqLog.info({ totalMs, providerMs, dbMs: totalMs - providerMs }, "Snapshot complete");

		return { snapshot_id: result.snapshotId };
	} catch (err) {
		reqLog.error({ err }, "Snapshot error");
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: err instanceof Error ? err.message : "Failed to create snapshot",
		});
	}
}
