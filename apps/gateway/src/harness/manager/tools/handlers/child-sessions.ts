import type { Logger } from "@proliferate/logger";
import { sessions, workers } from "@proliferate/services";
import type { ManagerToolContext } from "../../wake-cycle/types";
import { getServiceJwt } from "../auth";

export async function handleSpawnChildTask(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const title = args.title as string;
	const instructions = args.instructions as string;

	const managerSession = await sessions.findSessionById(ctx.managerSessionId, ctx.organizationId);
	if (!managerSession) {
		return JSON.stringify({ error: "Manager session not found" });
	}

	const childSession = await sessions.createUnifiedTaskSession({
		organizationId: ctx.organizationId,
		createdBy: managerSession.createdBy ?? "system",
		repoId: managerSession.repoId ?? null,
		repoBaselineId: managerSession.repoBaselineId ?? null,
		repoBaselineTargetId: managerSession.repoBaselineTargetId ?? null,
		workerId: ctx.workerId,
		workerRunId: ctx.workerRunId,
		parentSessionId: ctx.managerSessionId,
		configurationId: managerSession.configurationId ?? null,
		visibility: (managerSession.visibility as "private" | "shared" | "org") ?? "private",
		initialPrompt: instructions,
		title,
	});

	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "task_spawned",
		summaryText: title,
		sessionId: childSession.id,
		payloadJson: { title, childSessionId: childSession.id },
	});

	log.info({ childSessionId: childSession.id, title }, "Spawned child task session");

	try {
		const jwt = await getServiceJwt(ctx);
		const res = await fetch(`${ctx.gatewayUrl}/proliferate/${childSession.id}/eager-start`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ organizationId: ctx.organizationId }),
		});
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			log.warn({ childSessionId: childSession.id }, `Eager-start returned ${res.status}: ${body}`);
		}
	} catch (err) {
		log.warn({ err, childSessionId: childSession.id }, "Eager-start request failed");
	}

	return JSON.stringify({ session_id: childSession.id, title, status: "starting" });
}

export async function handleListChildren(ctx: ManagerToolContext, log: Logger): Promise<string> {
	const children = await sessions.listChildSessionsByRun(
		ctx.managerSessionId,
		ctx.workerRunId,
		ctx.organizationId,
	);

	const result = children.map((session) => ({
		session_id: session.id,
		title: session.title,
		status: session.status,
		runtime_status: session.runtimeStatus,
		operator_status: session.operatorStatus,
		outcome: session.outcome,
		summary: session.summary,
	}));

	log.debug({ count: result.length }, "Listed child sessions");
	return JSON.stringify({ children: result });
}

export async function handleInspectChild(
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

export async function handleMessageChild(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const sessionId = args.session_id as string;
	const content = args.content as string;

	const session = await sessions.findSessionById(sessionId, ctx.organizationId);
	if (!session) {
		return JSON.stringify({ error: `Session not found: ${sessionId}` });
	}
	if (session.parentSessionId !== ctx.managerSessionId) {
		return JSON.stringify({ error: "Session is not a child of this manager" });
	}

	try {
		const jwt = await getServiceJwt(ctx);
		const res = await fetch(`${ctx.gatewayUrl}/proliferate/${sessionId}/message`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
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

export async function handleCancelChild(
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

	try {
		const jwt = await getServiceJwt(ctx);
		const res = await fetch(`${ctx.gatewayUrl}/proliferate/${sessionId}/cancel`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
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
