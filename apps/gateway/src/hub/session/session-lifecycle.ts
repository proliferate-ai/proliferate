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
	runtimeStatus: string;
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
// K4: Session state projection (V2)
// ============================================

export async function projectSessionState(input: {
	sessionId: string;
	sandboxState?: SessionSandboxState;
	agentState?: SessionAgentState;
	terminalState?: SessionTerminalState | null;
	stateReason?: SessionStateReason | null;
	logger: Logger;
}): Promise<void> {
	try {
		await sessions.updateSession(input.sessionId, {
			...(input.sandboxState && { sandboxState: input.sandboxState }),
			...(input.agentState && { agentState: input.agentState }),
			...(input.terminalState !== undefined && { terminalState: input.terminalState }),
			...(input.stateReason !== undefined && { stateReason: input.stateReason }),
			stateUpdatedAt: new Date().toISOString(),
		});
	} catch (err) {
		input.logger.warn(
			{
				err,
				sessionId: input.sessionId,
				sandboxState: input.sandboxState,
				agentState: input.agentState,
			},
			"Failed to project session state",
		);
	}
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
