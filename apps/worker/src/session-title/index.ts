/**
 * Session title generation worker.
 *
 * Processes async title generation jobs using an LLM (Haiku).
 */

import type { Logger } from "@proliferate/logger";
import type { Job, Worker } from "@proliferate/queue";
import {
	type SessionTitleGenerationJob,
	createSessionTitleGenerationWorker,
} from "@proliferate/queue";
import { sessions } from "@proliferate/services";

interface SessionTitleWorkers {
	worker: Worker<SessionTitleGenerationJob>;
}

export function startSessionTitleWorkers(logger: Logger): SessionTitleWorkers {
	const worker = createSessionTitleGenerationWorker(async (job) => {
		await processSessionTitleJob(job, logger);
	});

	worker.on("failed", (job, err) => {
		if (!job) {
			logger.error({ err }, "Session title generation job failed (no job context)");
			return;
		}
		logger.error(
			{ err, jobId: job.id, sessionId: job.data.sessionId },
			"Session title generation job failed",
		);
	});

	logger.info("Session title generation worker started");
	return { worker };
}

export async function stopSessionTitleWorkers(workers: SessionTitleWorkers): Promise<void> {
	await workers.worker.close();
}

async function processSessionTitleJob(
	job: Job<SessionTitleGenerationJob>,
	logger: Logger,
): Promise<void> {
	const { sessionId, orgId, prompt } = job.data;
	const log = logger.child({ op: "generate-title", sessionId });

	// Fetch session — skip if already titled or deleted
	const session = await sessions.getSession(sessionId, orgId);
	if (!session) {
		log.info("Session not found, skipping title generation");
		return;
	}
	if (session.title) {
		log.info("Session already has a title, skipping");
		await sessions.updateSessionWithOrgCheck(sessionId, orgId, { titleStatus: null });
		return;
	}

	log.info("Generating session title");
	let title: string;
	try {
		title = await sessions.generateSessionTitle(prompt);
	} catch (err) {
		log.error({ err }, "LLM title generation failed, falling back to text extraction");
		title = sessions.deriveTitleFromPrompt(prompt) ?? "New session";
	}

	await sessions.updateSessionWithOrgCheck(sessionId, orgId, {
		title,
		titleStatus: null,
	});
	log.info({ title }, "Session title generated");
}
