/**
 * Session pause service.
 *
 * Takes a snapshot and terminates the sandbox.
 */

import type { SandboxProviderType } from "@proliferate/shared";
import type { BillingPlan } from "@proliferate/shared/billing";
import { revokeVirtualKey } from "@proliferate/shared/llm-proxy";
import { getSandboxProvider } from "@proliferate/shared/providers";
import * as billing from "../billing";
import { prepareForSnapshot } from "../lib/snapshot-scrub";
import { getServicesLogger } from "../logger";
import * as notifications from "../notifications";
import * as orgs from "../orgs";
import { updateLastVisibleUpdateAt } from "./db";
import { getFullSession, updateSession } from "./service";
import { SessionNotFoundError, recordSessionEvent } from "./service";

export { SessionNotFoundError };

export class SessionInvalidStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionInvalidStateError";
	}
}

export interface PauseSessionInput {
	sessionId: string;
	orgId: string;
}

export interface PauseSessionResult {
	paused: boolean;
	snapshotId: string | null;
}

export async function pauseSession(input: PauseSessionInput): Promise<PauseSessionResult> {
	const { sessionId, orgId } = input;
	const log = getServicesLogger().child({ module: "sessions/pause", sessionId });

	const session = await getFullSession(sessionId, orgId);

	if (!session) {
		throw new SessionNotFoundError(sessionId);
	}

	if (session.status !== "running") {
		throw new SessionInvalidStateError(`Cannot pause session with status '${session.status}'`);
	}

	if (!session.sandboxId) {
		throw new SessionInvalidStateError("Session has no active sandbox");
	}

	const org = await orgs.getBillingInfoV2(orgId);
	const plan: BillingPlan = org?.billingPlan === "pro" ? "pro" : "dev";
	const provider = getSandboxProvider(session.sandboxProvider as SandboxProviderType);

	const capacity = await billing.ensureSnapshotCapacity(
		orgId,
		plan,
		billing.deleteSnapshotFromProvider,
	);

	let snapshotId: string | null = null;

	if (capacity.allowed) {
		const finalizeSnapshotPrep = await prepareForSnapshot({
			provider,
			sandboxId: session.sandboxId,
			configurationId: session.configurationId ?? null,
			logger: log,
			logContext: "web_pause_snapshot",
			failureMode: "log",
			reapplyAfterCapture: false,
		});
		try {
			const snapshotResult = await provider.snapshot(sessionId, session.sandboxId);
			snapshotId = snapshotResult.snapshotId;
		} catch (err) {
			log.error({ err }, "Snapshot error, pausing without snapshot");
		} finally {
			await finalizeSnapshotPrep();
		}
	} else {
		log.warn("Snapshot quota exceeded, pausing without snapshot");
	}

	try {
		await provider.terminate(sessionId, session.sandboxId);
		revokeVirtualKey(sessionId).catch((err) => {
			log.debug({ err }, "Failed to revoke virtual key");
		});
	} catch (err) {
		log.error({ err }, "Failed to terminate sandbox");
	}

	try {
		await billing.finalizeSessionBilling(sessionId);
	} catch (err) {
		log.error({ err }, "Failed to finalize billing");
	}

	try {
		await updateSession(sessionId, {
			status: "paused",
			pauseReason: "manual",
			snapshotId,
			sandboxId: null,
			openCodeTunnelUrl: null,
			previewTunnelUrl: null,
			codingAgentSessionId: null,
			pausedAt: new Date().toISOString(),
			latestTask: null,
		});
	} catch (err) {
		log.error({ err }, "Failed to update session");
		throw new Error("Failed to update session after pause");
	}

	try {
		await updateLastVisibleUpdateAt(sessionId);
	} catch (err) {
		log.warn({ err }, "Failed to update lastVisibleUpdateAt on pause");
	}

	try {
		await recordSessionEvent({ sessionId, eventType: "session_paused" });
	} catch (err) {
		log.warn({ err }, "Failed to record session_paused event");
	}

	try {
		await notifications.enqueueSessionCompletionNotification(orgId, sessionId);
	} catch (err) {
		log.error({ err }, "Failed to enqueue session completion notification");
	}

	return { paused: true, snapshotId };
}
