import { nextRuntime } from "@proliferate/environment/runtime";
import * as Sentry from "@sentry/nextjs";

export async function register() {
	if (nextRuntime === "nodejs") {
		await import("../sentry.server.config");
	}

	if (nextRuntime === "edge") {
		await import("../sentry.edge.config");
	}
}

export const onRequestError = Sentry.captureRequestError;
