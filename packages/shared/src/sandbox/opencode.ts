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
 * Supports multiple providers:
 * - Anthropic models use the native "anthropic" provider
 * - Non-Anthropic models (OpenAI, Google) use a custom "litellm" provider
 *   configured as OpenAI-compatible, routing through the same LiteLLM proxy
 *
 * @param opencodeModelId - The OpenCode-formatted model ID (e.g., "anthropic/claude-opus-4-6" or "litellm/gpt-5.2")
 * @param proxyBaseUrl - Optional LLM proxy base URL (shared by all providers)
 * @param proxyApiKey - Optional API key to embed in config (avoid for sandboxed proxy keys; prefer env)
 */
export function getOpencodeConfig(
	opencodeModelId: string,
	proxyBaseUrl?: string,
	proxyApiKey?: string,
): string {
	// Build Anthropic provider options
	const anthropicOptions: string[] = [];
	if (proxyBaseUrl) {
		anthropicOptions.push(`"baseURL": "${proxyBaseUrl}"`);
	}
	if (proxyApiKey) {
		anthropicOptions.push(`"apiKey": "${proxyApiKey}"`);
	}

	const anthropicBlock =
		anthropicOptions.length > 0
			? `"anthropic": {
      "options": {
        ${anthropicOptions.join(",\n        ")}
      }
    }`
			: '"anthropic": {}';

	// Build LiteLLM provider (OpenAI-compatible) for non-Anthropic models
	const litellmOptions: string[] = [];
	if (proxyBaseUrl) {
		litellmOptions.push(`"baseURL": "${proxyBaseUrl}"`);
	}
	if (proxyApiKey) {
		litellmOptions.push(`"apiKey": "${proxyApiKey}"`);
	}

	const litellmBlock = `"litellm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LiteLLM",
      "options": {
        ${litellmOptions.length > 0 ? litellmOptions.join(",\n        ") : ""}
      },
      "models": {
        "gpt-5.2": { "name": "GPT-5.2" },
        "gemini-3-pro-preview": { "name": "Gemini 3 Pro" },
        "gemini-3-flash-preview": { "name": "Gemini 3 Flash" }
      }
    }`;

	return `{
  "$schema": "https://opencode.ai/config.json",
  "model": "${opencodeModelId}",
  "provider": {
    ${anthropicBlock},
    ${litellmBlock}
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
