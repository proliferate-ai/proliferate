/**
 * OpenCode Configuration and Utilities
 *
 * Shared utilities for configuring and interacting with OpenCode
 * in sandboxes. Used by all sandbox providers.
 */

import { getSharedLogger } from "../logger";
import { SANDBOX_PATHS } from "./config";

/**
 * Generate OpenCode configuration JSON.
 *
 * @param opencodeModelId - The OpenCode-formatted model ID (e.g., "claude-sonnet-4-20250514")
 * @param anthropicBaseUrl - Optional custom base URL for Anthropic API (e.g., LLM proxy)
 * @param anthropicApiKey - Optional API key to embed in config (avoid for sandboxed proxy keys; prefer env)
 */
export function getOpencodeConfig(
	opencodeModelId: string,
	anthropicBaseUrl?: string,
	anthropicApiKey?: string,
): string {
	// Build provider config - add baseURL and apiKey if using a proxy
	let providerConfig: string;
	const optionEntries: string[] = [];
	if (anthropicBaseUrl) {
		optionEntries.push(`"baseURL": "${anthropicBaseUrl}"`);
	}
	if (anthropicApiKey) {
		optionEntries.push(`"apiKey": "${anthropicApiKey}"`);
	}

	if (optionEntries.length > 0) {
		providerConfig = `"anthropic": {
      "options": {
        ${optionEntries.join(",\n        ")}
      }
    }`;
	} else {
		providerConfig = '"anthropic": {}';
	}

	return `{
  "$schema": "https://opencode.ai/config.json",
  "model": "${opencodeModelId}",
  "provider": {
    ${providerConfig}
  },
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0"
  },
  "plugin": ["${SANDBOX_PATHS.globalPluginDir}/proliferate.mjs"],
  "permission": {
    "*": "allow",
    "question": "deny"
  },
  "mcp": {}
}`;
}

/**
 * Wait for OpenCode server to be ready with exponential backoff.
 * Throws error if not ready within timeout.
 *
 * @param tunnelUrl - The HTTPS URL to the OpenCode server
 * @param maxWaitMs - Maximum time to wait in milliseconds (default: 30000)
 * @param log - Optional logging function
 */
export async function waitForOpenCodeReady(
	tunnelUrl: string,
	maxWaitMs = 30000,
	log: (msg: string) => void = (msg) => getSharedLogger().debug({ module: "opencode" }, msg),
): Promise<void> {
	const startTime = Date.now();
	let attempt = 0;
	let lastStatus: number | null = null;
	let lastError: string | null = null;
	let lastErrorCode: string | null = null;

	while (Date.now() - startTime < maxWaitMs) {
		attempt++;
		const elapsedMs = Date.now() - startTime;
		try {
			const response = await fetch(`${tunnelUrl}/session`, {
				signal: AbortSignal.timeout(5000),
			});
			if (response.ok) {
				log(`[P-LATENCY] Agent ready after ${attempt} attempts (${Date.now() - startTime}ms)`);
				return;
			}
			lastStatus = response.status;
			log(
				`[P-LATENCY] Agent readiness probe attempt=${attempt} status=${response.status} elapsedMs=${elapsedMs}`,
			);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			const cause =
				err.cause && typeof err.cause === "object"
					? (err.cause as { code?: unknown; message?: unknown })
					: undefined;
			lastError = err.message;
			lastErrorCode = typeof cause?.code === "string" ? cause.code : null;
			const codeSuffix = lastErrorCode ? `/${lastErrorCode}` : "";
			log(
				`[P-LATENCY] Agent readiness probe attempt=${attempt} error=${err.name}${codeSuffix} elapsedMs=${elapsedMs} message=${err.message}`,
			);
		}
		// Exponential backoff: 200ms, 300ms, 450ms, ... up to 2s max
		const delay = Math.min(200 * 1.5 ** (attempt - 1), 2000);
		await new Promise((r) => setTimeout(r, delay));
	}

	const statusSuffix = lastStatus !== null ? `, lastStatus=${lastStatus}` : "";
	const errorSuffix = lastError ? `, lastError=${lastError}` : "";
	const codeSuffix = lastErrorCode ? `, lastErrorCode=${lastErrorCode}` : "";
	throw new Error(
		`[P-LATENCY] Agent not ready after ${maxWaitMs}ms (${attempt} attempts${statusSuffix}${errorSuffix}${codeSuffix})`,
	);
}

/**
 * Session metadata stored in sandbox for robust state tracking
 */
export interface SessionMetadata {
	sessionId: string;
	repoDir: string;
	createdAt: number;
	/** Epoch ms of last successful git clone or pull. Used by cadence gate. */
	lastGitFetchAt?: number;
}
