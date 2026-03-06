/**
 * Session lifecycle helpers for the gateway.
 *
 * Centralizes outcome persistence, operator status projection,
 * lastVisibleUpdateAt writes, and session event recording.
 */

import type { Logger } from "@proliferate/logger";
import { sessions } from "@proliferate/services";
import type {
	SessionAgentState,
	SessionOutcome,
	SessionRuntimeStatus,
	SessionSandboxState,
	SessionStateReason,
	SessionTerminalState,
} from "@proliferate/shared/contracts/sessions";
import {
	SESSION_LIFECYCLE_EVENT,
	type SessionLifecycleEventType,
} from "../shared/lifecycle-events";

// ============================================
// K1: Terminal outcome persistence
// ============================================

export async function persistTerminalOutcome(input: {
	sessionId: string;
	organizationId: string;
	runtimeStatus: SessionRuntimeStatus;
	summary?: string | null;
	prUrls?: string[];
	errorMessage?: string | null;
	logger: Logger;
}): Promise<void> {
	const { sessionId, organizationId, runtimeStatus, logger: log } = input;

	try {
		// Enrich outcome from existing session telemetry (prUrls, summary, metrics)
		const session = await sessions.findSessionByIdInternal(sessionId);

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
		const eventType: SessionLifecycleEventType =
			runtimeStatus === "completed"
				? SESSION_LIFECYCLE_EVENT.COMPLETED
				: runtimeStatus === "failed"
					? SESSION_LIFECYCLE_EVENT.FAILED
					: SESSION_LIFECYCLE_EVENT.CANCELLED;
		await sessions.recordSessionEvent({
			sessionId,
			eventType,
		});
		await sessions.recordSessionEvent({
			sessionId,
			eventType: SESSION_LIFECYCLE_EVENT.OUTCOME_PERSISTED,
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
	runtimeStatus: SessionRuntimeStatus;
	hasPendingApproval: boolean;
	isAgentIdle?: boolean;
	logger: Logger;
}): Promise<string> {
	const { sessionId, runtimeStatus, hasPendingApproval, isAgentIdle, logger: log } = input;

	let agentState: SessionAgentState = "iterating";
	let terminalState: SessionTerminalState | null = null;
	let sandboxState: SessionSandboxState | undefined;
	let stateReason: SessionStateReason | null = null;

	if (runtimeStatus === "completed") {
		agentState = "done";
		terminalState = "succeeded";
		sandboxState = "terminated";
	} else if (runtimeStatus === "cancelled") {
		agentState = "done";
		terminalState = "cancelled";
		sandboxState = "terminated";
		stateReason = "cancelled_by_user";
	} else if (runtimeStatus === "failed") {
		agentState = "errored";
		terminalState = "failed";
		sandboxState = "failed";
		stateReason = "runtime_error";
	} else if (hasPendingApproval) {
		agentState = "waiting_approval";
		stateReason = "approval_required";
	} else if (isAgentIdle) {
		agentState = "waiting_input";
	} else if (runtimeStatus === "running") {
		agentState = "iterating";
		sandboxState = "running";
	} else {
		agentState = "iterating";
	}

	try {
		await sessions.updateSession(sessionId, {
			agentState,
			...(sandboxState ? { sandboxState } : {}),
			...(terminalState ? { terminalState } : {}),
			stateReason,
		});
	} catch (err) {
		log.warn({ err, sessionId, agentState }, "Failed to update canonical agent state");
	}

	return agentState;
}

// ============================================
// K5: Session event recording helpers
// ============================================

export async function recordLifecycleEvent(
	sessionId: string,
	eventType: SessionLifecycleEventType,
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
