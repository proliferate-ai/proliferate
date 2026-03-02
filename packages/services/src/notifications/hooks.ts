/**
 * Notification hooks — service-layer side effects on state transitions.
 *
 * These are called by run/session/action services when lifecycle
 * transitions happen. They enqueue notifications via the outbox
 * for async delivery.
 */

import { env } from "@proliferate/environment/server";
import type { NotificationCategory, NotificationPayload } from "@proliferate/shared/contracts";
import { enqueueOutbox } from "../outbox/service";

interface NotificationHookContext {
	organizationId: string;
	userId: string;
	workerId?: string | null;
	sessionId?: string | null;
	runId?: string | null;
}

function buildAppUrl(): string {
	return env.NEXT_PUBLIC_APP_URL ?? "https://app.proliferate.com";
}

/**
 * Hook: Run reached terminal state (completed or failed).
 * Creates run_completed or run_failed notification.
 */
export async function onRunTerminal(
	ctx: NotificationHookContext & {
		status: "succeeded" | "failed";
		runName?: string;
		summary?: string;
		errorMessage?: string;
	},
): Promise<void> {
	const category: NotificationCategory =
		ctx.status === "succeeded" ? "run_completed" : "run_failed";
	const appUrl = buildAppUrl();

	const payload: NotificationPayload = {
		title:
			ctx.status === "succeeded"
				? `Run completed: ${ctx.runName ?? "Unnamed run"}`
				: `Run failed: ${ctx.runName ?? "Unnamed run"}`,
		summary:
			ctx.status === "succeeded"
				? (ctx.summary ?? "The run completed successfully.")
				: (ctx.errorMessage ?? "The run failed."),
		deepLinks: ctx.sessionId
			? [{ label: "View Session", url: `${appUrl}/workspace/${ctx.sessionId}` }]
			: [],
		severity: ctx.status === "succeeded" ? "normal" : "high",
	};

	await enqueueOutbox({
		organizationId: ctx.organizationId,
		kind: "notify_v1",
		payload: {
			userId: ctx.userId,
			category,
			payload,
			workerId: ctx.workerId ?? null,
			sessionId: ctx.sessionId ?? null,
			runId: ctx.runId ?? null,
		},
	});
}

/**
 * Hook: Action invocation requires approval.
 * Creates approval_required notification (immediate, never batched).
 */
export async function onApprovalRequired(
	ctx: NotificationHookContext & {
		invocationId: string;
		actionName: string;
		reason?: string;
	},
): Promise<void> {
	const appUrl = buildAppUrl();

	const payload: NotificationPayload = {
		title: `Approval required: ${ctx.actionName}`,
		summary: ctx.reason ?? `The agent needs approval to execute "${ctx.actionName}".`,
		deepLinks: ctx.sessionId
			? [{ label: "Review", url: `${appUrl}/workspace/${ctx.sessionId}` }]
			: [],
		severity: "urgent",
		actionContext: { invocationId: ctx.invocationId },
	};

	await enqueueOutbox({
		organizationId: ctx.organizationId,
		kind: "notify_v1",
		payload: {
			userId: ctx.userId,
			category: "approval_required" satisfies NotificationCategory,
			payload,
			workerId: ctx.workerId ?? null,
			sessionId: ctx.sessionId ?? null,
			runId: ctx.runId ?? null,
		},
	});
}

/**
 * Hook: Agent health degraded.
 * Creates agent_health_degraded notification.
 */
export async function onAgentHealthDegraded(
	ctx: NotificationHookContext & {
		workerName?: string;
		reason?: string;
	},
): Promise<void> {
	const appUrl = buildAppUrl();

	const payload: NotificationPayload = {
		title: `Coworker degraded: ${ctx.workerName ?? "Unknown"}`,
		summary: ctx.reason ?? "The coworker's health has degraded.",
		deepLinks: ctx.workerId
			? [{ label: "View Coworker", url: `${appUrl}/dashboard/coworkers/${ctx.workerId}` }]
			: [],
		severity: "high",
	};

	await enqueueOutbox({
		organizationId: ctx.organizationId,
		kind: "notify_v1",
		payload: {
			userId: ctx.userId,
			category: "agent_health_degraded" satisfies NotificationCategory,
			payload,
			workerId: ctx.workerId ?? null,
			sessionId: ctx.sessionId ?? null,
			runId: ctx.runId ?? null,
		},
	});
}

/**
 * Hook: Run blocked (e.g., needs human intervention, sandbox lost).
 * Creates run_blocked notification.
 */
export async function onRunBlocked(
	ctx: NotificationHookContext & {
		runName?: string;
		reason?: string;
	},
): Promise<void> {
	const appUrl = buildAppUrl();

	const payload: NotificationPayload = {
		title: `Run blocked: ${ctx.runName ?? "Unnamed run"}`,
		summary: ctx.reason ?? "The run is blocked and needs attention.",
		deepLinks: ctx.sessionId
			? [{ label: "View Session", url: `${appUrl}/workspace/${ctx.sessionId}` }]
			: [],
		severity: "high",
	};

	await enqueueOutbox({
		organizationId: ctx.organizationId,
		kind: "notify_v1",
		payload: {
			userId: ctx.userId,
			category: "run_blocked" satisfies NotificationCategory,
			payload,
			workerId: ctx.workerId ?? null,
			sessionId: ctx.sessionId ?? null,
			runId: ctx.runId ?? null,
		},
	});
}
