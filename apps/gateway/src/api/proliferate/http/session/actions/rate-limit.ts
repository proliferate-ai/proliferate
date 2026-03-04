import { ApiError } from "../../../../../middleware/errors";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

const invokeCounters = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of invokeCounters) {
		if (now >= entry.resetAt) {
			invokeCounters.delete(key);
		}
	}
}, RATE_LIMIT_WINDOW_MS);

export function checkInvokeRateLimit(sessionId: string): void {
	const now = Date.now();
	let entry = invokeCounters.get(sessionId);
	if (!entry || now >= entry.resetAt) {
		entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
		invokeCounters.set(sessionId, entry);
	}

	entry.count++;
	if (entry.count > RATE_LIMIT_MAX) {
		throw new ApiError(429, "Too many action invocations. Try again later.");
	}
}
