/**
 * Manager tool definitions and handlers.
 *
 * Each tool maps to either a direct service call (for DB operations)
 * or a gateway HTTP call (for hub-mediated operations like messaging).
 *
 * When the manager moves to sandbox (Phase B), these switch to HTTP-only.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "@proliferate/logger";
import { sessions, sourceReads, workers } from "@proliferate/services";
import type { ManagerToolContext } from "./manager-types";

// ============================================
// Source-read capability keys
// ============================================

const SOURCE_READ_TOOL_NAMES = new Set(["read_source", "get_source_item", "list_source_bindings"]);

/**
 * Filter manager tools based on session capabilities.
 * Source-read tools are hidden when all source.*.read keys are denied.
 * Individual source types are gated at the service layer (CREDENTIAL_MISSING).
 *
 * Default for source reads: no-approval (allow by default).
 */
export function filterToolsByCapabilities(
	tools: Anthropic.Tool[],
	deniedCapabilities: Set<string>,
): Anthropic.Tool[] {
	// If any source.*.read is denied, check if ALL are denied
	const sourceReadKeys = ["source.sentry.read", "source.linear.read", "source.github.read"];
	const allSourceDenied = sourceReadKeys.every((key) => deniedCapabilities.has(key));

	if (!allSourceDenied) return tools;

	// Remove source-read tools entirely when all sources are denied
	return tools.filter((tool) => !SOURCE_READ_TOOL_NAMES.has(tool.name));
}

// ============================================
// Tool Definitions
// ============================================

export const MANAGER_TOOLS: Anthropic.Tool[] = [
	{
		name: "spawn_child_task",
		description:
			"Spawn a new child coding task session. The session inherits the coworker's repo and baseline settings. Returns the session ID.",
		input_schema: {
			type: "object" as const,
			properties: {
				title: {
					type: "string",
					description: "Short title describing the task",
				},
				instructions: {
					type: "string",
					description: "Detailed instructions for the coding agent",
				},
			},
			required: ["title", "instructions"],
		},
	},
	{
		name: "list_children",
		description: "List all child task sessions spawned during this run.",
		input_schema: {
			type: "object" as const,
			properties: {},
		},
	},
	{
		name: "inspect_child",
		description:
			"Get detailed status of a child task session including runtime status, operator status, outcome, and summary.",
		input_schema: {
			type: "object" as const,
			properties: {
				session_id: {
					type: "string",
					description: "The child session ID to inspect",
				},
			},
			required: ["session_id"],
		},
	},
	{
		name: "message_child",
		description: "Send a follow-up message to a running child task session.",
		input_schema: {
			type: "object" as const,
			properties: {
				session_id: {
					type: "string",
					description: "The child session ID to message",
				},
				content: {
					type: "string",
					description: "The message content to send",
				},
			},
			required: ["session_id", "content"],
		},
	},
	{
		name: "cancel_child",
		description: "Cancel a running child task session.",
		input_schema: {
			type: "object" as const,
			properties: {
				session_id: {
					type: "string",
					description: "The child session ID to cancel",
				},
			},
			required: ["session_id"],
		},
	},
	{
		name: "read_source",
		description:
			"Read data from a connected source binding (Sentry issues, Linear tickets, GitHub issues/PRs). Use list_source_bindings first to discover available bindings.",
		input_schema: {
			type: "object" as const,
			properties: {
				binding_id: {
					type: "string",
					description: "The binding ID to query (from list_source_bindings)",
				},
				cursor: {
					type: "string",
					description: "Pagination cursor from a previous query",
				},
				limit: {
					type: "number",
					description: "Max items to return (1-100, default 25)",
				},
			},
			required: ["binding_id"],
		},
	},
	{
		name: "get_source_item",
		description: "Get detailed information about a single source item by its reference ID.",
		input_schema: {
			type: "object" as const,
			properties: {
				binding_id: {
					type: "string",
					description: "The binding ID this item belongs to",
				},
				item_ref: {
					type: "string",
					description: "The source-specific item reference (e.g., issue ID)",
				},
			},
			required: ["binding_id", "item_ref"],
		},
	},
	{
		name: "list_source_bindings",
		description:
			"List all connected source bindings for this coworker. Returns binding IDs, source types (sentry/linear/github), and labels.",
		input_schema: {
			type: "object" as const,
			properties: {},
		},
	},
	{
		name: "list_capabilities",
		description: "List available action capabilities and their current permission modes.",
		input_schema: {
			type: "object" as const,
			properties: {},
		},
	},
	{
		name: "invoke_action",
		description:
			"Invoke an external action through the action boundary (e.g., create a Linear issue, post a Slack message). Actions may require approval.",
		input_schema: {
			type: "object" as const,
			properties: {
				integration: {
					type: "string",
					description:
						'The integration identifier (e.g., "linear", "sentry", "github", "connector:<id>")',
				},
				action: {
					type: "string",
					description: "The action ID to invoke",
				},
				params: {
					type: "object",
					description: "Action-specific parameters",
				},
			},
			required: ["integration", "action", "params"],
		},
	},
	{
		name: "send_notification",
		description:
			"Send a notification to the human operator (in-app and/or Slack). Use this for status updates, escalations, or when human attention is needed.",
		input_schema: {
			type: "object" as const,
			properties: {
				message: {
					type: "string",
					description: "The notification message",
				},
				severity: {
					type: "string",
					enum: ["info", "warning", "error"],
					description: "Notification severity level",
				},
			},
			required: ["message"],
		},
	},
	{
		name: "request_approval",
		description:
			"Pause execution and request human approval before proceeding with a significant action.",
		input_schema: {
			type: "object" as const,
			properties: {
				description: {
					type: "string",
					description: "What you want to do and why approval is needed",
				},
			},
			required: ["description"],
		},
	},
	{
		name: "skip_run",
		description:
			"Declare this run as no-action-needed. Use during triage when the wake event does not require any work.",
		input_schema: {
			type: "object" as const,
			properties: {
				reason: {
					type: "string",
					description: "Why no action is needed",
				},
			},
			required: ["reason"],
		},
	},
	{
		name: "complete_run",
		description:
			"Finalize this run with a summary. Call this after all child tasks are done or after orchestration is complete.",
		input_schema: {
			type: "object" as const,
			properties: {
				summary: {
					type: "string",
					description: "Summary of what was accomplished during this run",
				},
			},
			required: ["summary"],
		},
	},
];

// ============================================
// Tool Handlers
// ============================================

export async function executeManagerTool(
	name: string,
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	switch (name) {
		case "spawn_child_task":
			return handleSpawnChildTask(args, ctx, log);
		case "list_children":
			return handleListChildren(ctx, log);
		case "inspect_child":
			return handleInspectChild(args, ctx, log);
		case "message_child":
			return handleMessageChild(args, ctx, log);
		case "cancel_child":
			return handleCancelChild(args, ctx, log);
		case "read_source":
			return handleReadSource(args, ctx, log);
		case "get_source_item":
			return handleGetSourceItem(args, ctx, log);
		case "list_source_bindings":
			return handleListSourceBindings(ctx, log);
		case "list_capabilities":
			return handleListCapabilities(ctx, log);
		case "invoke_action":
			return handleInvokeAction(args, ctx, log);
		case "send_notification":
			return handleSendNotification(args, ctx, log);
		case "request_approval":
			return handleRequestApproval(args, ctx, log);
		case "skip_run":
			return handleSkipRun(args, ctx, log);
		case "complete_run":
			return handleCompleteRun(args, ctx, log);
		default:
			return JSON.stringify({ error: `Unknown tool: ${name}` });
	}
}

// ============================================
// Individual Tool Handlers
// ============================================

async function handleSpawnChildTask(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const title = args.title as string;
	const instructions = args.instructions as string;

	// Look up the manager session to inherit repo linkage
	const managerSession = await sessions.findSessionById(ctx.managerSessionId, ctx.organizationId);
	if (!managerSession) {
		return JSON.stringify({ error: "Manager session not found" });
	}

	if (
		!managerSession.repoId ||
		!managerSession.repoBaselineId ||
		!managerSession.repoBaselineTargetId
	) {
		return JSON.stringify({ error: "Manager session missing repo linkage for child task" });
	}

	const childSession = await sessions.createUnifiedTaskSession({
		organizationId: ctx.organizationId,
		createdBy: managerSession.createdBy ?? "system",
		repoId: managerSession.repoId,
		repoBaselineId: managerSession.repoBaselineId,
		repoBaselineTargetId: managerSession.repoBaselineTargetId,
		workerId: ctx.workerId,
		workerRunId: ctx.workerRunId,
		parentSessionId: ctx.managerSessionId,
		configurationId: managerSession.configurationId ?? null,
		visibility: (managerSession.visibility as "private" | "shared" | "org") ?? "private",
		initialPrompt: instructions,
		title,
	});

	// Emit task_spawned run event
	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "task_spawned",
		summaryText: title,
		sessionId: childSession.id,
		payloadJson: { title, childSessionId: childSession.id },
	});

	log.info({ childSessionId: childSession.id, title }, "Spawned child task session");

	// Boot the child session via gateway HTTP eager-start
	try {
		const res = await fetch(`${ctx.gatewayUrl}/proliferate/${childSession.id}/eager-start`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${ctx.serviceToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ organizationId: ctx.organizationId }),
		});
		if (!res.ok) {
			log.warn(
				{ status: res.status, childSessionId: childSession.id },
				"Eager-start returned non-ok",
			);
		}
	} catch (err) {
		log.warn({ err, childSessionId: childSession.id }, "Eager-start request failed");
	}

	return JSON.stringify({ session_id: childSession.id, title, status: "starting" });
}

async function handleListChildren(ctx: ManagerToolContext, log: Logger): Promise<string> {
	const children = await sessions.listChildSessionsByRun(
		ctx.managerSessionId,
		ctx.workerRunId,
		ctx.organizationId,
	);

	const result = children.map((s) => ({
		session_id: s.id,
		title: s.title,
		status: s.status,
		runtime_status: s.runtimeStatus,
		operator_status: s.operatorStatus,
		outcome: s.outcome,
		summary: s.summary,
	}));

	log.debug({ count: result.length }, "Listed child sessions");
	return JSON.stringify({ children: result });
}

async function handleInspectChild(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const sessionId = args.session_id as string;
	const session = await sessions.findSessionById(sessionId, ctx.organizationId);
	if (!session) {
		return JSON.stringify({ error: `Session not found: ${sessionId}` });
	}

	// Verify it's a child of this manager
	if (session.parentSessionId !== ctx.managerSessionId) {
		return JSON.stringify({ error: "Session is not a child of this manager" });
	}

	log.debug({ sessionId }, "Inspected child session");
	return JSON.stringify({
		session_id: session.id,
		title: session.title,
		status: session.status,
		runtime_status: session.runtimeStatus,
		operator_status: session.operatorStatus,
		outcome: session.outcome,
		summary: session.summary,
		latest_task: session.latestTask,
		pr_urls: session.prUrls,
		started_at: session.startedAt?.toISOString() ?? null,
		ended_at: session.endedAt?.toISOString() ?? null,
	});
}

async function handleMessageChild(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const sessionId = args.session_id as string;
	const content = args.content as string;

	// Verify the session exists and is a child
	const session = await sessions.findSessionById(sessionId, ctx.organizationId);
	if (!session) {
		return JSON.stringify({ error: `Session not found: ${sessionId}` });
	}
	if (session.parentSessionId !== ctx.managerSessionId) {
		return JSON.stringify({ error: "Session is not a child of this manager" });
	}

	// Send message via gateway HTTP
	try {
		const res = await fetch(`${ctx.gatewayUrl}/proliferate/${sessionId}/message`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${ctx.serviceToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				type: "prompt",
				content,
				userId: "manager",
				source: "automation",
			}),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			return JSON.stringify({ error: `Message failed: ${res.status} ${text}` });
		}
	} catch (err) {
		return JSON.stringify({ error: `Message request failed: ${String(err)}` });
	}

	log.info({ sessionId, contentLength: content.length }, "Sent message to child session");
	return JSON.stringify({ ok: true });
}

async function handleCancelChild(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const sessionId = args.session_id as string;

	const session = await sessions.findSessionById(sessionId, ctx.organizationId);
	if (!session) {
		return JSON.stringify({ error: `Session not found: ${sessionId}` });
	}
	if (session.parentSessionId !== ctx.managerSessionId) {
		return JSON.stringify({ error: "Session is not a child of this manager" });
	}

	// Cancel via gateway HTTP
	try {
		const res = await fetch(`${ctx.gatewayUrl}/proliferate/${sessionId}/cancel`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${ctx.serviceToken}`,
				"Content-Type": "application/json",
			},
		});
		if (!res.ok) {
			log.warn({ status: res.status, sessionId }, "Cancel returned non-ok");
		}
	} catch (err) {
		log.warn({ err, sessionId }, "Cancel request failed");
	}

	log.info({ sessionId }, "Cancelled child session");
	return JSON.stringify({ ok: true, session_id: sessionId });
}

async function handleReadSource(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const bindingId = args.binding_id as string;
	const cursor = args.cursor as string | undefined;
	const limit = args.limit as number | undefined;

	try {
		const result = await sourceReads.querySource(bindingId, ctx.organizationId, cursor, limit);

		// Emit source_observation for each item
		for (const item of result.items) {
			await workers.appendWorkerRunEvent({
				workerRunId: ctx.workerRunId,
				workerId: ctx.workerId,
				eventType: "source_observation",
				summaryText: item.title,
				payloadJson: {
					sourceType: item.sourceType,
					sourceRef: item.sourceRef,
					severity: item.severity,
				},
				dedupeKey: `source:${item.sourceType}:${item.sourceRef}`,
			});
		}

		log.info({ bindingId, itemCount: result.items.length }, "Source read completed");
		return JSON.stringify(result);
	} catch (err) {
		if (err instanceof sourceReads.BindingNotFoundError) {
			return JSON.stringify({ error: err.message, code: err.code });
		}
		if (err instanceof sourceReads.CredentialMissingError) {
			return JSON.stringify({ error: err.message, code: err.code });
		}
		return JSON.stringify({ error: `Source read failed: ${String(err)}` });
	}
}

async function handleGetSourceItem(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const bindingId = args.binding_id as string;
	const itemRef = args.item_ref as string;

	try {
		const item = await sourceReads.getSourceItem(bindingId, ctx.organizationId, itemRef);
		if (!item) {
			return JSON.stringify({ error: "Source item not found" });
		}

		// Emit source_observation
		await workers.appendWorkerRunEvent({
			workerRunId: ctx.workerRunId,
			workerId: ctx.workerId,
			eventType: "source_observation",
			summaryText: item.title,
			payloadJson: {
				sourceType: item.sourceType,
				sourceRef: item.sourceRef,
				severity: item.severity,
			},
			dedupeKey: `source:${item.sourceType}:${item.sourceRef}`,
		});

		log.info({ bindingId, itemRef }, "Source item retrieved");
		return JSON.stringify({ item });
	} catch (err) {
		if (err instanceof sourceReads.BindingNotFoundError) {
			return JSON.stringify({ error: err.message, code: err.code });
		}
		if (err instanceof sourceReads.CredentialMissingError) {
			return JSON.stringify({ error: err.message, code: err.code });
		}
		return JSON.stringify({ error: `Source item read failed: ${String(err)}` });
	}
}

async function handleListSourceBindings(ctx: ManagerToolContext, log: Logger): Promise<string> {
	try {
		const bindings = await sourceReads.listBindings(ctx.workerId, ctx.organizationId);
		log.debug({ count: bindings.length }, "Listed source bindings");
		return JSON.stringify({ bindings });
	} catch (err) {
		return JSON.stringify({ error: `Failed to list bindings: ${String(err)}` });
	}
}

async function handleListCapabilities(ctx: ManagerToolContext, log: Logger): Promise<string> {
	// List available actions via gateway HTTP
	try {
		const res = await fetch(
			`${ctx.gatewayUrl}/proliferate/${ctx.managerSessionId}/actions/available`,
			{
				headers: {
					Authorization: `Bearer ${ctx.serviceToken}`,
				},
			},
		);
		if (!res.ok) {
			return JSON.stringify({ error: `Failed to list capabilities: ${res.status}` });
		}
		const data = await res.json();
		log.debug("Listed capabilities");
		return JSON.stringify(data);
	} catch (err) {
		return JSON.stringify({ error: `Capabilities request failed: ${String(err)}` });
	}
}

async function handleInvokeAction(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const integration = args.integration as string;
	const action = args.action as string;
	const params = (args.params as Record<string, unknown>) ?? {};

	try {
		const res = await fetch(
			`${ctx.gatewayUrl}/proliferate/${ctx.managerSessionId}/actions/invoke`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${ctx.serviceToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ integration, action, params }),
			},
		);

		const data = await res.json();

		// Emit action event
		const eventType =
			res.status === 202
				? "action_pending_approval"
				: res.ok
					? "action_completed"
					: "action_failed";
		await workers.appendWorkerRunEvent({
			workerRunId: ctx.workerRunId,
			workerId: ctx.workerId,
			eventType,
			summaryText: `${integration}:${action}`,
			payloadJson: { integration, action, status: res.status },
		});

		log.info({ integration, action, status: res.status }, "Action invocation result");
		return JSON.stringify(data);
	} catch (err) {
		await workers.appendWorkerRunEvent({
			workerRunId: ctx.workerRunId,
			workerId: ctx.workerId,
			eventType: "action_failed",
			summaryText: `${integration}:${action} - request error`,
			payloadJson: { integration, action, error: String(err) },
		});
		return JSON.stringify({ error: `Action invocation failed: ${String(err)}` });
	}
}

async function handleSendNotification(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const message = args.message as string;
	const severity = (args.severity as string) ?? "info";

	// Emit as a manager_note run event (notifications service integration deferred to Phase F)
	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "manager_note",
		summaryText: message,
		payloadJson: { severity, type: "notification" },
	});

	log.info({ severity, messageLength: message.length }, "Notification sent");
	return JSON.stringify({ ok: true, delivered_as: "run_event" });
}

async function handleRequestApproval(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const description = args.description as string;

	// Emit as a run event; actual approval flow deferred to Phase H UI
	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "action_pending_approval",
		summaryText: description,
		payloadJson: { type: "manager_approval_request", description },
	});

	log.info({ descriptionLength: description.length }, "Approval requested");
	return JSON.stringify({
		ok: true,
		status: "pending",
		note: "Approval request recorded. Approval UI is implemented in Phase H.",
	});
}

async function handleSkipRun(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const reason = args.reason as string;

	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "triage_summary",
		summaryText: `Skipped: ${reason}`,
		payloadJson: { decision: "skip", reason },
	});

	log.info({ reason }, "Run skipped");
	return JSON.stringify({ ok: true, outcome: "skipped", reason });
}

async function handleCompleteRun(
	args: Record<string, unknown>,
	_ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const summary = args.summary as string;

	log.info({ summaryLength: summary.length }, "Run completed");
	return JSON.stringify({ ok: true, outcome: "completed", summary });
}
