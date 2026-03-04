import type { Logger } from "@proliferate/logger";
import { PhaseTimeoutError } from "./errors";
import { PHASE_TIMEOUT_MS, type WakeCyclePhase } from "./types";

export async function runWakeCyclePhase<T>(
	phase: WakeCyclePhase,
	log: Logger,
	fn: () => Promise<T>,
): Promise<T> {
	const startMs = Date.now();
	log.info({ phase, timeoutMs: PHASE_TIMEOUT_MS[phase] }, `Phase ${phase} starting`);

	let timer: ReturnType<typeof setTimeout>;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new PhaseTimeoutError(phase)), PHASE_TIMEOUT_MS[phase]);
	});

	try {
		const result = await Promise.race([fn(), timeoutPromise]);
		log.info({ phase, durationMs: Date.now() - startMs }, `Phase ${phase} completed`);
		return result;
	} catch (err) {
		log.error({ phase, durationMs: Date.now() - startMs, err }, `Phase ${phase} failed`);
		throw err;
	} finally {
		clearTimeout(timer!);
	}
}
