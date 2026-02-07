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

function resolveDefaultGitToken(repoSpecs?: RepoSpec[]): string | null {
	if (!repoSpecs || repoSpecs.length === 0) return null;
	const primaryToken = repoSpecs.find((spec) => Boolean(spec.token))?.token;
	return primaryToken || null;
}

export async function buildSandboxEnvVars(input: SandboxEnvInput): Promise<SandboxEnvResult> {
	const envVars: Record<string, string> = {};
	const requireProxy =
		input.requireProxy === true || input.requireProxy === ("true" as unknown as boolean)
			? true
			: input.requireProxy === false || input.requireProxy === ("false" as unknown as boolean)
				? false
				: process.env.LLM_PROXY_REQUIRED === "true";
	const proxyUrl = process.env.LLM_PROXY_URL;

	if (!proxyUrl) {
		if (requireProxy) {
			throw new Error("LLM proxy is required but LLM_PROXY_URL is not set");
		}
		envVars.ANTHROPIC_API_KEY = input.directApiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
	} else {
		try {
			const apiKey = await generateSessionAPIKey(input.sessionId, input.orgId);
			envVars.LLM_PROXY_API_KEY = apiKey;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`LLM proxy enabled but failed to generate session key: ${message}`);
		}
	}

	// Decrypt and add secrets (both org-scoped and repo-scoped)
	const secretRows = await secrets.getSecretsForSession(input.orgId, input.repoIds);
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

	return { envVars, usesProxy: Boolean(proxyUrl) };
}
