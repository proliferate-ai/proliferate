/**
 * Sandbox environment variable provisioning.
 *
 * Centralizes logic for LLM proxy key generation, secret decryption,
 * and default Git token setup so both web and gateway use identical behavior.
 */

import { type RepoSpec, isValidTargetPath } from "@proliferate/shared";
import { generateSessionAPIKey } from "@proliferate/shared/llm-proxy";
import { decrypt, getEncryptionKey } from "../db/crypto";
import { getServicesLogger } from "../logger";
import { getBillingInfoV2 } from "../orgs/service";
import * as secretFiles from "../secret-files";
import * as secrets from "../secrets";

export interface SandboxEnvInput {
	sessionId: string;
	orgId: string;
	repoIds: string[];
	configurationId?: string | null;
	repoSpecs?: RepoSpec[];
	requireProxy?: boolean;
	directApiKey?: string;
}

export interface SandboxFileWrite {
	filePath: string;
	content: string;
}

export interface SandboxEnvResult {
	envVars: Record<string, string>;
	usesProxy: boolean;
	fileWrites: SandboxFileWrite[];
}

export interface SessionBootSecretMaterial {
	envVars: Record<string, string>;
	fileWrites: SandboxFileWrite[];
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

interface ResolvedSecretValue {
	value: string;
	priority: number;
	updatedAtMs: number;
}

/**
 * Normalizes a file path by trimming whitespace and removing leading dot-slashes.
 */
function normalizeFilePath(filePath: string): string {
	return filePath.trim().replace(/^\.\/+/, "");
}

/**
 * Extracts the Unix timestamp in milliseconds from a Date object, defaulting to 0 if null.
 */
function updatedAtMs(updatedAt: Date | null): number {
	return updatedAt ? updatedAt.getTime() : 0;
}

/**
 * Assigns a secret value to the target map if it has higher precedence
 * or is newer than the existing value.
 */
function assignSecretWithPrecedence(
	target: Record<string, ResolvedSecretValue>,
	key: string,
	entry: ResolvedSecretValue,
): void {
	const existing = target[key];
	if (!existing) {
		target[key] = entry;
		return;
	}
	if (entry.priority > existing.priority) {
		target[key] = entry;
		return;
	}
	if (entry.priority === existing.priority && entry.updatedAtMs >= existing.updatedAtMs) {
		target[key] = entry;
	}
}

/**
 * Canonical session-boot secret resolver.
 *
 * Precedence: configuration-scoped > repo-scoped > org-scoped.
 */
export async function resolveSessionBootSecretMaterial(input: {
	sessionId: string;
	orgId: string;
	repoIds: string[];
	configurationId?: string | null;
}): Promise<SessionBootSecretMaterial> {
	const logger = getServicesLogger().child({
		module: "sandbox-env",
		phase: "resolve-session-boot-secret-material",
		sessionId: input.sessionId,
		orgId: input.orgId,
		configurationId: input.configurationId ?? null,
	});

	const fetchStartMs = Date.now();
	const [sessionScopeRows, configurationScopeRows, secretFileRows] = await Promise.all([
		secrets.getScopedSecretsForSession(input.orgId, input.repoIds),
		input.configurationId
			? secrets.getScopedSecretsForConfiguration(input.orgId, input.configurationId)
			: Promise.resolve([]),
		input.configurationId
			? secretFiles.listEncryptedByConfiguration(input.orgId, input.configurationId)
			: Promise.resolve([]),
	]);
	logger.debug(
		{
			durationMs: Date.now() - fetchStartMs,
			orgRepoSecretCount: sessionScopeRows.length,
			configurationSecretCount: configurationScopeRows.length,
			secretFileCount: secretFileRows.length,
		},
		"Fetched boot-time secret sources",
	);

	const encryptionKey = getEncryptionKey();
	const resolvedSecrets: Record<string, ResolvedSecretValue> = {};

	for (const secret of sessionScopeRows) {
		try {
			assignSecretWithPrecedence(resolvedSecrets, secret.key, {
				value: decrypt(secret.encryptedValue, encryptionKey),
				priority: secret.repoId ? 1 : 0,
				updatedAtMs: updatedAtMs(secret.updatedAt),
			});
		} catch (err) {
			logger.error({ err, secretKey: secret.key }, "Failed to decrypt org/repo secret");
		}
	}

	for (const secret of configurationScopeRows) {
		try {
			assignSecretWithPrecedence(resolvedSecrets, secret.key, {
				value: decrypt(secret.encryptedValue, encryptionKey),
				priority: 2,
				updatedAtMs: updatedAtMs(secret.updatedAt),
			});
		} catch (err) {
			logger.error(
				{ err, secretKey: secret.key, configurationId: input.configurationId ?? null },
				"Failed to decrypt configuration secret",
			);
		}
	}

	const envVars = Object.fromEntries(
		Object.entries(resolvedSecrets).map(([key, value]) => [key, value.value]),
	);

	const fileWrites: SandboxFileWrite[] = [];
	for (const row of secretFileRows) {
		const normalizedPath = normalizeFilePath(row.filePath);
		if (!isValidTargetPath(normalizedPath)) {
			logger.warn(
				{ filePath: row.filePath, normalizedPath },
				"Skipping invalid secret file path at boot",
			);
			continue;
		}

		try {
			fileWrites.push({
				filePath: normalizedPath,
				content: decrypt(row.encryptedContent, encryptionKey),
			});
		} catch (err) {
			logger.error(
				{ err, filePath: row.filePath, secretFileId: row.id },
				"Failed to decrypt secret file content",
			);
		}
	}

	return { envVars, fileWrites };
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
	const useProxy = requireProxy && Boolean(proxyUrl);

	logger.debug(
		{
			repoCount: input.repoIds.length,
			requireProxy,
			useProxy,
			hasProxyUrl: Boolean(proxyUrl),
			hasDirectApiKey: Boolean(input.directApiKey ?? process.env.ANTHROPIC_API_KEY),
		},
		"Building sandbox env vars",
	);

	if (!requireProxy) {
		envVars.ANTHROPIC_API_KEY = input.directApiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
	} else {
		if (!proxyUrl) {
			throw new Error("LLM proxy is required but LLM_PROXY_URL is not set");
		}
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

	// Resolve and merge all boot-time secrets (env vars + secret files).
	const secretsStartMs = Date.now();
	const secretMaterial = await resolveSessionBootSecretMaterial({
		sessionId: input.sessionId,
		orgId: input.orgId,
		repoIds: input.repoIds,
		configurationId: input.configurationId,
	});
	Object.assign(envVars, secretMaterial.envVars);
	logger.debug(
		{
			durationMs: Date.now() - secretsStartMs,
			envKeyCount: Object.keys(secretMaterial.envVars).length,
			fileWriteCount: secretMaterial.fileWrites.length,
		},
		"Resolved boot-time secret material",
	);

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
			usesProxy: useProxy,
			fileWriteCount: secretMaterial.fileWrites.length,
		},
		"Sandbox env vars build complete",
	);
	return { envVars, usesProxy: useProxy, fileWrites: secretMaterial.fileWrites };
}
