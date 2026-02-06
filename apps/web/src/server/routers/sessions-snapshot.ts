/**
 * Session snapshot handler.
 *
 * Creates a snapshot of the session's current state.
 * Extracted from ts-rest router for use in oRPC.
 */

import { ORPCError } from "@orpc/server";
import { sessions } from "@proliferate/services";
import type { SandboxProviderType } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

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

	// Get full session data
	const session = await sessions.getFullSession(sessionId, orgId);

	if (!session) {
		throw new ORPCError("NOT_FOUND", { message: "Session not found" });
	}

	if (!session.sandboxId) {
		throw new ORPCError("BAD_REQUEST", { message: "Session has no sandbox" });
	}

	// Take snapshot via provider
	try {
		const startTime = Date.now();
		console.log(`[Timing] Snapshot ${sessionId.slice(0, 8)} started`);

		const providerType = session.sandboxProvider as SandboxProviderType | undefined;
		const provider = getSandboxProvider(providerType);
		const result = await provider.snapshot(sessionId, session.sandboxId);
		const providerMs = Date.now() - startTime;
		console.log(`[Timing] +${providerMs}ms ${provider.type} provider.snapshot complete`);

		// Update session with snapshot_id
		await sessions.updateSession(sessionId, { snapshotId: result.snapshotId });
		const totalMs = Date.now() - startTime;
		console.log(
			`[Timing] +${totalMs}ms snapshot complete (provider: ${providerMs}ms, db: ${totalMs - providerMs}ms)`,
		);

		return { snapshot_id: result.snapshotId };
	} catch (err) {
		console.error("Snapshot error:", err);
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: err instanceof Error ? err.message : "Failed to create snapshot",
		});
	}
}
