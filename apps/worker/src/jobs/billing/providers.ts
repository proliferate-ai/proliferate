/**
 * Shared provider utilities for billing jobs.
 */

import { env } from "@proliferate/environment/server";
import type { SandboxProvider } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

/**
 * Build a providers map for sandbox operations (liveness checks, termination).
 */
export async function getProvidersMap(): Promise<Map<string, SandboxProvider>> {
	const providers = new Map<string, SandboxProvider>();

	if (env.E2B_API_KEY) {
		try {
			const e2bProvider = getSandboxProvider("e2b");
			providers.set("e2b", e2bProvider);
		} catch {
			// E2B not available
		}
	}

	if (env.MODAL_TOKEN_ID && env.MODAL_TOKEN_SECRET) {
		try {
			const modalProvider = getSandboxProvider("modal");
			providers.set("modal", modalProvider);
		} catch {
			// Modal not available
		}
	}

	return providers;
}
