/**
 * Sandbox environment variable provisioning.
 *
 * Centralizes logic for LLM proxy key generation, secret decryption,
 * and default Git token setup so both web and gateway use identical behavior.
 */

import type { RepoSpec } from "@proliferate/shared";
import { generateSessionAPIKey } from "@proliferate/shared/llm-proxy";
import { decrypt, getEncryptionKey } from "../db/crypto";
import * as secrets from "../secrets";

export interface SandboxEnvInput {
	sessionId: string;
	orgId: string;
	repoIds: string[];
	repoSpecs?: RepoSpec[];
	requireProxy?: boolean;
	directApiKey?: string;
}

export interface SandboxEnvResult {
	envVars: Record<string, string>;
	usesProxy: boolean;
}

const normalizeBoolean = (value: unknown, fallback = false) => {
	if (value === true || value === "true" || value === "1") return true;
	if (value === false || value === "false" || value === "0") return false;
	return fallback;
};

function resolveDefaultGitToken(repoSpecs?: RepoSpec[]): string | null {
	if (!repoSpecs || repoSpecs.length === 0) return null;
	const primaryToken = repoSpecs.find((spec) => Boolean(spec.token))?.token;
	return primaryToken || null;
}

export async function buildSandboxEnvVars(input: SandboxEnvInput): Promise<SandboxEnvResult> {
	const startMs = Date.now();
	const envVars: Record<string, string> = {};
	const requireProxy = normalizeBoolean(
		input.requireProxy ?? process.env.LLM_PROXY_REQUIRED,
		false,
	);
	const proxyUrl = process.env.LLM_PROXY_URL;

	console.log("[P-LATENCY] sandbox_env.build.start", {
		sessionId: input.sessionId,
		shortId: input.sessionId.slice(0, 8),
		repoCount: input.repoIds.length,
		requireProxy,
		hasProxyUrl: Boolean(proxyUrl),
		hasDirectApiKey: Boolean(input.directApiKey ?? process.env.ANTHROPIC_API_KEY),
	});

	if (!proxyUrl) {
		if (requireProxy) {
			throw new Error("LLM proxy is required but LLM_PROXY_URL is not set");
		}
		envVars.ANTHROPIC_API_KEY = input.directApiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
	} else {
		try {
			const keyStartMs = Date.now();
			const apiKey = await generateSessionAPIKey(input.sessionId, input.orgId);
			console.log("[P-LATENCY] sandbox_env.llm_proxy.generate_session_key", {
				sessionId: input.sessionId,
				shortId: input.sessionId.slice(0, 8),
				durationMs: Date.now() - keyStartMs,
			});
			envVars.LLM_PROXY_API_KEY = apiKey;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error("[P-LATENCY] sandbox_env.llm_proxy.generate_session_key.error", {
				sessionId: input.sessionId,
				shortId: input.sessionId.slice(0, 8),
				durationMs: Date.now() - startMs,
				error: message,
			});
			throw new Error(`LLM proxy enabled but failed to generate session key: ${message}`);
		}
	}

	// Decrypt and add secrets (both org-scoped and repo-scoped)
	const secretsStartMs = Date.now();
	const secretRows = await secrets.getSecretsForSession(input.orgId, input.repoIds);
	console.log("[P-LATENCY] sandbox_env.secrets.fetch", {
		sessionId: input.sessionId,
		shortId: input.sessionId.slice(0, 8),
		durationMs: Date.now() - secretsStartMs,
		count: secretRows?.length ?? 0,
	});
	if (secretRows && secretRows.length > 0) {
		const encryptionKey = getEncryptionKey();
		for (const secret of secretRows) {
			try {
				envVars[secret.key] = decrypt(secret.encryptedValue, encryptionKey);
			} catch (err) {
				console.error("Failed to decrypt secret", secret.key, err);
			}
		}
	}

	// Default git/GitHub tokens for post-clone operations
	const defaultGitToken = resolveDefaultGitToken(input.repoSpecs);
	if (defaultGitToken) {
		envVars.GIT_TOKEN = defaultGitToken;
		envVars.GH_TOKEN = defaultGitToken;
	}

	console.log("[P-LATENCY] sandbox_env.build.complete", {
		sessionId: input.sessionId,
		shortId: input.sessionId.slice(0, 8),
		durationMs: Date.now() - startMs,
		envKeyCount: Object.keys(envVars).length,
		usesProxy: Boolean(proxyUrl),
	});
	return { envVars, usesProxy: Boolean(proxyUrl) };
}
