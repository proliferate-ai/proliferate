/**
 * Shared provider utilities for billing jobs.
 */

import type { SandboxProvider } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";

/**
 * Build a providers map for sandbox operations (liveness checks, termination).
 */
export async function getProvidersMap(): Promise<Map<string, SandboxProvider>> {
	const providers = new Map<string, SandboxProvider>();

	try {
		const e2bProvider = getSandboxProvider("e2b");
		providers.set("e2b", e2bProvider);
	} catch {
		// E2B not available
	}

	return providers;
}
