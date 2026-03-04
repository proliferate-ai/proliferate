import { env } from "@proliferate/environment/server";
import type { SandboxApiOpts, SandboxConnectOpts } from "e2b";
import { SANDBOX_TIMEOUT_MS } from "../../../sandbox";

/** Template id used for fresh E2B sandbox creation. */
export const E2B_TEMPLATE = env.E2B_TEMPLATE || undefined;
/** Optional custom API domain for self-hosted/private E2B deployments. */
export const E2B_DOMAIN = env.E2B_DOMAIN || undefined;

/** Builds API options for direct E2B REST calls. */
export function getE2BApiOpts(): SandboxApiOpts {
	const opts: SandboxApiOpts = {};
	if (env.E2B_API_KEY) {
		opts.apiKey = env.E2B_API_KEY;
	}
	if (E2B_DOMAIN) {
		opts.domain = E2B_DOMAIN;
	}
	return opts;
}

/** Builds connection options for E2B SDK connect/list/get operations. */
export function getE2BConnectOpts(): SandboxConnectOpts {
	const opts: SandboxConnectOpts = {
		...getE2BApiOpts(),
		timeoutMs: SANDBOX_TIMEOUT_MS,
	};
	return opts;
}
