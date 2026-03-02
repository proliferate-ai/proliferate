/**
 * Session lifecycle helpers for the gateway.
 *
 * Centralizes outcome persistence, operator status projection,
 * lastVisibleUpdateAt writes, and session event recording.
 */

import type { Logger } from "@proliferate/logger";
import { sessions } from "@proliferate/services";
import type { SessionOutcome } from "@proliferate/shared";

// ============================================
// K1: Terminal outcome persistence
// ============================================

export async function persistTerminalOutcome(input: {
	sessionId: string;
	organizationId: string;
	runtimeStatus: string;
	summary?: string | null;
	prUrls?: string[];
	errorMessage?: string | null;
	logger: Logger;
}): Promise<void> {
	const { sessionId, organizationId, runtimeStatus, logger: log } = input;

	try {
		// Enrich outcome from existing session telemetry (prUrls, summary, metrics)
		const session = await sessions.findByIdInternal(sessionId);

		const prUrlList = input.prUrls ?? (session?.prUrls as string[] | null) ?? [];
		const firstPr =
			prUrlList.length > 0
				? { url: prUrlList[0], number: 0, state: "open" as const, branch: "" }
				: null;

		const outcomeJson: SessionOutcome = {
			summary: input.summary ?? (session?.summary as string | null) ?? null,
			changedFileCount: 0,
			topChangedFiles: [],
			testSummary: null,
			pullRequest: firstPr,
			errorCode: runtimeStatus === "failed" ? "runtime_failure" : null,
			errorMessage: input.errorMessage ?? null,
		};

		await sessions.persistTerminalTaskOutcome({
			sessionId,
			organizationId,
			outcomeJson,
			outcomeVersion: 1,
		});

		// Record lifecycle event
		const eventType =
			runtimeStatus === "completed"
				? "session_completed"
				: runtimeStatus === "failed"
					? "session_failed"
					: "session_cancelled";
		await sessions.recordSessionEvent({
			sessionId,
			eventType,
		});
		await sessions.recordSessionEvent({
			sessionId,
			eventType: "session_outcome_persisted",
		});

		log.info({ sessionId, runtimeStatus }, "Persisted terminal outcome");
	} catch (err) {
		// Best-effort — don't let outcome persistence failure break terminal flow
		log.warn({ err, sessionId }, "Failed to persist terminal outcome");
	}
}

// ============================================
// K3: lastVisibleUpdateAt writer
// ============================================

export async function touchLastVisibleUpdate(sessionId: string, logger: Logger): Promise<void> {
	try {
		await sessions.updateLastVisibleUpdateAt(sessionId);
	} catch (err) {
		logger.warn({ err, sessionId }, "Failed to update lastVisibleUpdateAt");
	}
}

// ============================================
// K4: Operator status projection
// ============================================

export async function projectOperatorStatus(input: {
	sessionId: string;
	organizationId: string;
	runtimeStatus: string;
	hasPendingApproval: boolean;
	isAgentIdle?: boolean;
	logger: Logger;
}): Promise<string> {
	const {
		sessionId,
		organizationId,
		runtimeStatus,
		hasPendingApproval,
		isAgentIdle,
		logger: log,
	} = input;

	let operatorStatus: string;

	if (runtimeStatus === "completed" || runtimeStatus === "cancelled") {
		operatorStatus = "ready_for_review";
	} else if (runtimeStatus === "failed") {
		operatorStatus = "errored";
	} else if (hasPendingApproval) {
		operatorStatus = "waiting_for_approval";
	} else if (isAgentIdle) {
		operatorStatus = "needs_input";
	} else if (runtimeStatus === "running") {
		operatorStatus = "active";
	} else {
		operatorStatus = "active";
	}

	try {
		await sessions.updateSessionOperatorStatus({
			sessionId,
			organizationId,
			operatorStatus,
		});
	} catch (err) {
		log.warn({ err, sessionId, operatorStatus }, "Failed to update operator status");
	}

	return operatorStatus;
}

// ============================================
// K5: Session event recording helpers
// ============================================

export async function recordLifecycleEvent(
	sessionId: string,
	eventType: string,
	logger: Logger,
): Promise<void> {
	try {
		await sessions.recordSessionEvent({
			sessionId,
			eventType,
		});
	} catch (err) {
		logger.warn({ err, sessionId, eventType }, "Failed to record session event");
	}
}
