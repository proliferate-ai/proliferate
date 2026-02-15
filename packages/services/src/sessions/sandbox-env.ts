/**
 * Sandbox environment variable provisioning.
 *
 * Centralizes logic for LLM proxy key generation, secret decryption,
 * and default Git token setup so both web and gateway use identical behavior.
 */

import type { RepoSpec } from "@proliferate/shared";
import { generateSessionAPIKey } from "@proliferate/shared/llm-proxy";
import { decrypt, getEncryptionKey } from "../db/crypto";
import { getServicesLogger } from "../logger";
import { getBillingInfoV2 } from "../orgs/service";
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
	const logger = getServicesLogger().child({ module: "sandbox-env", sessionId: input.sessionId });
	const envVars: Record<string, string> = {};
	const requireProxy = normalizeBoolean(
		input.requireProxy ?? process.env.LLM_PROXY_REQUIRED,
		false,
	);
	const proxyUrl = process.env.LLM_PROXY_URL;

	logger.debug(
		{
			repoCount: input.repoIds.length,
			requireProxy,
			hasProxyUrl: Boolean(proxyUrl),
			hasDirectApiKey: Boolean(input.directApiKey ?? process.env.ANTHROPIC_API_KEY),
		},
		"Building sandbox env vars",
	);

	if (!proxyUrl) {
		if (requireProxy) {
			throw new Error("LLM proxy is required but LLM_PROXY_URL is not set");
		}
		envVars.ANTHROPIC_API_KEY = input.directApiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
	} else {
		try {
			const keyStartMs = Date.now();

			// Derive max budget from shadow balance when billing is enabled
			let maxBudget: number | undefined;
			const billingEnabled =
				process.env.NEXT_PUBLIC_BILLING_ENABLED === "true" ||
				process.env.NEXT_PUBLIC_BILLING_ENABLED === "1" ||
				process.env.DEPLOYMENT_PROFILE === "cloud";
			if (billingEnabled) {
				const orgBilling = await getBillingInfoV2(input.orgId);
				if (orgBilling?.shadowBalance != null) {
					maxBudget = Math.max(0, Number(orgBilling.shadowBalance) * 0.01);
				}
			}

			const apiKey = await generateSessionAPIKey(input.sessionId, input.orgId, { maxBudget });
			logger.debug(
				{ durationMs: Date.now() - keyStartMs, maxBudget },
				"Generated LLM proxy session key",
			);
			envVars.LLM_PROXY_API_KEY = apiKey;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(
				{ err, durationMs: Date.now() - startMs },
				"Failed to generate LLM proxy session key",
			);
			throw new Error(`LLM proxy enabled but failed to generate session key: ${message}`);
		}
	}

	// Decrypt and add secrets (both org-scoped and repo-scoped)
	const secretsStartMs = Date.now();
	const secretRows = await secrets.getSecretsForSession(input.orgId, input.repoIds);
	logger.debug(
		{ durationMs: Date.now() - secretsStartMs, count: secretRows?.length ?? 0 },
		"Fetched secrets",
	);
	if (secretRows && secretRows.length > 0) {
		const encryptionKey = getEncryptionKey();
		for (const secret of secretRows) {
			try {
				envVars[secret.key] = decrypt(secret.encryptedValue, encryptionKey);
			} catch (err) {
				logger.error({ err, secretKey: secret.key }, "Failed to decrypt secret");
			}
		}
	}

	// Default git/GitHub tokens for post-clone operations
	const defaultGitToken = resolveDefaultGitToken(input.repoSpecs);
	if (defaultGitToken) {
		envVars.GIT_TOKEN = defaultGitToken;
		envVars.GH_TOKEN = defaultGitToken;
	}

	logger.debug(
		{
			durationMs: Date.now() - startMs,
			envKeyCount: Object.keys(envVars).length,
			usesProxy: Boolean(proxyUrl),
		},
		"Sandbox env vars build complete",
	);
	return { envVars, usesProxy: Boolean(proxyUrl) };
}
