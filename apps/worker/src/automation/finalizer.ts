/**
 * Automation run finalizer — reconciles stale runs against session + provider liveness.
 */

/**
 * Minimal session status shape (mirrors SessionStatusResponse from gateway-clients).
 */
export interface SessionStatus {
	state: "running" | "terminated";
	status: string;
	terminatedAt?: string;
	reason?: string;
	sandboxId?: string;
	sandboxAlive?: boolean | null;
}

/**
 * Subset of a run needed by the finalizer.
 */
export interface FinalizerRun {
	id: string;
	organizationId: string;
	sessionId: string | null;
	triggerEventId: string;
	deadlineAt: Date | null;
	completionId: string | null;
}

/**
 * Dependencies injected into the finalizer (for testing).
 */
export interface FinalizerDeps {
	getSessionStatus(sessionId: string): Promise<SessionStatus>;
	markRunFailed(opts: {
		runId: string;
		reason: string;
		stage: string;
		errorMessage: string;
	}): Promise<unknown>;
	transitionRunStatus(
		runId: string,
		toStatus: string,
		updates: Record<string, unknown>,
	): Promise<unknown>;
	updateTriggerEvent(
		eventId: string,
		updates: { status: string; errorMessage: string; processedAt: Date },
	): Promise<unknown>;
	enqueueNotification?(organizationId: string, runId: string, status: string): Promise<void>;
	log: {
		info(obj: Record<string, unknown>, msg: string): void;
		warn(obj: Record<string, unknown>, msg: string): void;
	};
}

/**
 * Fail a run and its trigger event in one step.
 */
async function failRun(
	run: FinalizerRun,
	reason: string,
	errorMessage: string,
	deps: FinalizerDeps,
): Promise<void> {
	await deps.markRunFailed({
		runId: run.id,
		reason,
		stage: "finalizer",
		errorMessage,
	});
	await deps.updateTriggerEvent(run.triggerEventId, {
		status: "failed",
		errorMessage,
		processedAt: new Date(),
	});
	deps.log.info({ runId: run.id, reason }, "Run finalized");
}

/**
 * Reconcile a single stale run against session + provider liveness.
 */
export async function finalizeOneRun(run: FinalizerRun, deps: FinalizerDeps): Promise<void> {
	// 1. No session → fail immediately
	if (!run.sessionId) {
		await failRun(run, "missing_session", "Run has no session", deps);
		return;
	}

	// 2. Deadline exceeded → timed_out
	if (run.deadlineAt && run.deadlineAt < new Date()) {
		await deps.transitionRunStatus(run.id, "timed_out", {
			statusReason: "deadline_exceeded",
			failureStage: "finalizer",
			completedAt: new Date(),
		});
		await deps.updateTriggerEvent(run.triggerEventId, {
			status: "failed",
			errorMessage: "Run timed out (deadline exceeded)",
			processedAt: new Date(),
		});
		try {
			await deps.enqueueNotification?.(run.organizationId, run.id, "timed_out");
		} catch {
			// Non-critical: don't let notification failures break finalizer
		}
		deps.log.info({ runId: run.id }, "Run finalized: deadline_exceeded");
		return;
	}

	// 3. Check session status (includes provider liveness)
	let status: SessionStatus;
	try {
		status = await deps.getSessionStatus(run.sessionId);
	} catch (err) {
		// Gateway unreachable — skip this run, retry next tick
		deps.log.warn(
			{ err, runId: run.id } as Record<string, unknown>,
			"Session status check failed, will retry",
		);
		return;
	}

	// 4. Session terminated
	if (status.state === "terminated") {
		const hasCompletion = Boolean(run.completionId);
		if (hasCompletion) {
			// Completion was recorded but run status wasn't updated (edge case)
			return;
		}
		await failRun(
			run,
			"no_completion",
			status.reason
				? `Session terminated (${status.reason}) without calling automation.complete`
				: "Session terminated without calling automation.complete",
			deps,
		);
		return;
	}

	// 5. Sandbox dead but session still "running" in DB
	if (status.state === "running" && status.sandboxAlive === false) {
		await failRun(
			run,
			"sandbox_dead",
			`Sandbox ${status.sandboxId ?? "unknown"} is no longer running at the provider`,
			deps,
		);
		return;
	}

	// 6. Unexpected session state
	if (status.state !== "running") {
		await failRun(
			run,
			`session_state_${status.state}`,
			`Unexpected session state: ${status.state}`,
			deps,
		);
		return;
	}

	// Session is running and sandbox is alive (or liveness unknown) — leave it alone
}
