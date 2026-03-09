/**
 * Worker Job Tick Processor
 *
 * Processes a single BullMQ job tick: verifies the job and worker are still
 * eligible, sends the check-in prompt to the manager session via the gateway,
 * and updates tick timestamps.
 */

import { env } from "@proliferate/environment/server";
import { createSyncClient } from "@proliferate/gateway-clients";
import type { Job, WorkerJobTickPayload } from "@proliferate/queue";
import { workerJobs, workers as workersService } from "@proliferate/services";
import { CronExpressionParser } from "cron-parser";

import { logger as rootLogger } from "../lib/logger.js";

const logger = rootLogger.child({ module: "job-tick-processor" });

export async function processJobTick(job: Job<WorkerJobTickPayload>): Promise<void> {
	const { jobId, workerId, organizationId, managerSessionId } = job.data;

	const log = logger.child({ jobId, workerId, managerSessionId });

	// 1. Load the worker job — verify still exists and enabled
	let workerJob: Awaited<ReturnType<typeof workerJobs.findJobById>>;
	try {
		workerJob = await workerJobs.findJobById(jobId, organizationId);
	} catch (err) {
		if (err instanceof workerJobs.WorkerJobNotFoundError) {
			log.debug("Worker job not found, skipping tick");
			return;
		}
		throw err;
	}
	if (!workerJob.enabled) {
		log.debug("Worker job disabled, skipping tick");
		return;
	}

	// 2. Load the worker — verify status is active
	const worker = await workersService.findWorkerById(workerId, organizationId);
	if (!worker) {
		log.debug("Worker not found, skipping tick");
		return;
	}
	if (worker.status !== "active") {
		log.debug({ workerStatus: worker.status }, "Worker not active, skipping tick");
		return;
	}

	const gatewayUrl = env.NEXT_PUBLIC_GATEWAY_URL;
	const serviceToken = env.SERVICE_TO_SERVICE_AUTH_TOKEN;
	if (!gatewayUrl || !serviceToken) {
		log.warn("Gateway URL or service token not configured, skipping tick");
		return;
	}

	const gateway = createSyncClient({
		baseUrl: gatewayUrl,
		auth: { type: "service", name: "job-tick-engine", secret: serviceToken },
	});

	// 3. Eager-start the manager session (wake sandbox if cold)
	try {
		await gateway.eagerStart(managerSessionId);
	} catch (err) {
		log.warn({ err }, "Failed to eager-start manager session, continuing with prompt");
	}

	// 4. Send the check-in prompt (skipIfBusy + idempotency for safe retries)
	try {
		await gateway.postMessage(managerSessionId, {
			content: workerJob.checkInPrompt,
			userId: workerJobs.SYSTEM_JOB_TICK_USER_ID,
			skipIfBusy: true,
			idempotencyKey: `worker-job-tick:${jobId}:${job.id}`,
		});
	} catch (err) {
		log.error({ err }, "Failed to send job tick prompt");
		throw err;
	}

	// 5. Update lastTickAt and compute nextTickAt
	const now = new Date();
	let nextTickAt: Date;
	try {
		const expr = CronExpressionParser.parse(workerJob.cronExpression, { currentDate: now });
		nextTickAt = expr.next().toDate();
	} catch {
		log.warn(
			{ cronExpression: workerJob.cronExpression },
			"Failed to parse cron expression for nextTickAt",
		);
		nextTickAt = new Date(now.getTime() + 60_000);
	}

	await workerJobs.updateJobTickTimestamps(jobId, organizationId, now, nextTickAt);

	log.info({ nextTickAt: nextTickAt.toISOString() }, "Job tick processed");
}
