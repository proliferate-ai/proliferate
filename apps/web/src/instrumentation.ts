import { getNextRuntime } from "@/lib/config/runtime";
import * as Sentry from "@sentry/nextjs";

export async function register() {
	if (getNextRuntime() === "nodejs") {
		await import("../sentry.server.config");
	}

	if (getNextRuntime() === "edge") {
		await import("../sentry.edge.config");
	}
}

export const onRequestError = Sentry.captureRequestError;
