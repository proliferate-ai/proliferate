/**
 * OpenCode Configuration and Utilities
 *
 * Shared utilities for configuring and interacting with OpenCode
 * in sandboxes. Used by all sandbox providers.
 */

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

	const workspaceDir = `${SANDBOX_PATHS.home}/workspace`;

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
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["playwright-mcp", "--headless", "--browser", "chromium", "--no-sandbox", "--isolated", "--caps", "vision"],
      "enabled": true
    },
    "sandbox_mcp": {
      "type": "local",
      "command": ["sandbox-mcp", "mcp"],
      "enabled": true,
      "environment": {
        "WORKSPACE_DIR": "${workspaceDir}"
      }
    }
  }
}`;
}

/**
 * Wait for OpenCode server to be ready with exponential backoff.
 * Throws error if not ready within timeout.
 *
 * @param tunnelUrl - The HTTPS URL to the OpenCode server
 * @param maxWaitMs - Maximum time to wait in milliseconds (default: 30000)
 * @param log - Optional logging function (default: console.log)
 */
export async function waitForOpenCodeReady(
	tunnelUrl: string,
	maxWaitMs = 30000,
	log: (msg: string) => void = console.log,
): Promise<void> {
	const startTime = Date.now();
	let attempt = 0;

	while (Date.now() - startTime < maxWaitMs) {
		attempt++;
		try {
			const response = await fetch(`${tunnelUrl}/session`, {
				signal: AbortSignal.timeout(5000),
			});
			if (response.ok) {
				log(`[P-LATENCY] Agent ready after ${attempt} attempts (${Date.now() - startTime}ms)`);
				return;
			}
		} catch {
			// Not ready yet, retry
		}
		// Exponential backoff: 200ms, 300ms, 450ms, ... up to 2s max
		const delay = Math.min(200 * 1.5 ** (attempt - 1), 2000);
		await new Promise((r) => setTimeout(r, delay));
	}

	throw new Error(`[P-LATENCY] Agent not ready after ${maxWaitMs}ms (${attempt} attempts)`);
}

/**
 * Session metadata stored in sandbox for robust state tracking
 */
export interface SessionMetadata {
	sessionId: string;
	repoDir: string;
	createdAt: number;
}
