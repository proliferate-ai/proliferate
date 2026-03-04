/**
 * Secret Files service.
 *
 * Business logic layer that handles encryption, access control,
 * path validation, and sandbox apply for secret files.
 */

import path from "node:path";
import type { SandboxProviderType } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import * as configurationsModule from "../configurations/service";
import { encrypt, getEncryptionKey } from "../db/crypto";
import { getServicesLogger } from "../logger";
import * as orgsModule from "../orgs/service";
import * as sessionsModule from "../sessions";
import type { SecretFileBootRow, SecretFileMeta } from "./db";
import * as secretFilesDb from "./db";

// Re-export types for consumers
export type { SecretFileMeta, SecretFileBootRow } from "./db";

const logger = getServicesLogger().child({ module: "secret-files" });

// ============================================
// Domain Errors
// ============================================

export class SecretFileForbiddenError extends Error {
	constructor(message = "Only admins and owners can manage secret files") {
		super(message);
		this.name = "SecretFileForbiddenError";
	}
}

export class SecretFileConfigurationNotFoundError extends Error {
	constructor(message = "Configuration not found") {
		super(message);
		this.name = "SecretFileConfigurationNotFoundError";
	}
}

export class SecretFileNotFoundError extends Error {
	constructor(message = "Secret file not found") {
		super(message);
		this.name = "SecretFileNotFoundError";
	}
}

export class SecretFilePathValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SecretFilePathValidationError";
	}
}

export class SecretFileApplyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SecretFileApplyError";
	}
}

// ============================================
// Path Validation
// ============================================

/**
 * Normalize and validate a secret file path for sandbox use.
 * Must be a relative path under the workspace root.
 */
export function normalizeSecretFilePath(filePath: string): string {
	const trimmed = filePath.trim();
	if (!trimmed) {
		throw new SecretFilePathValidationError("Secret file path is required");
	}
	if (trimmed.includes("\0")) {
		throw new SecretFilePathValidationError("Secret file path contains invalid characters");
	}
	const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
	if (
		normalized.startsWith("/") ||
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		normalized.includes("/../")
	) {
		throw new SecretFilePathValidationError(
			"Secret file path must be a relative path under workspace",
		);
	}
	return normalized;
}

// ============================================
// Access Control Helpers
// ============================================

async function assertAdminOrOwner(userId: string, orgId: string): Promise<void> {
	const role = await orgsModule.getUserRole(userId, orgId);
	if (role !== "owner" && role !== "admin") {
		throw new SecretFileForbiddenError();
	}
}

async function assertConfigurationAccess(configurationId: string, orgId: string): Promise<void> {
	const belongsToOrg = await configurationsModule.configurationBelongsToOrg(configurationId, orgId);
	if (!belongsToOrg) {
		// Config ownership is inferred via linked repos. Empty configurations can
		// legitimately have no repo links, so fall back to existence check.
		const exists = await configurationsModule.configurationExists(configurationId);
		if (!exists) {
			throw new SecretFileConfigurationNotFoundError();
		}
	}
}

// ============================================
// Low-level DB wrappers (unchanged)
// ============================================

/**
 * List secret files for a configuration (metadata only, no content).
 */
export async function listByConfiguration(
	orgId: string,
	configurationId: string,
): Promise<SecretFileMeta[]> {
	return secretFilesDb.listByConfiguration(orgId, configurationId);
}

/**
 * List encrypted secret file rows for boot-time decrypt/injection.
 */
export async function listEncryptedByConfiguration(
	orgId: string,
	configurationId: string,
): Promise<SecretFileBootRow[]> {
	return secretFilesDb.listEncryptedByConfiguration(orgId, configurationId);
}

/**
 * Delete a secret file by ID within an org.
 */
export async function deleteById(id: string, orgId: string): Promise<boolean> {
	return secretFilesDb.deleteById(id, orgId);
}

/**
 * Upsert a secret file — encrypts content and stores it.
 */
export async function upsertSecretFile(input: {
	organizationId: string;
	configurationId: string;
	filePath: string;
	content: string;
	description?: string | null;
	createdBy: string;
}): Promise<SecretFileMeta> {
	const encryptionKey = getEncryptionKey();
	const encryptedContent = encrypt(input.content, encryptionKey);

	return secretFilesDb.upsert({
		organizationId: input.organizationId,
		configurationId: input.configurationId,
		filePath: input.filePath,
		encryptedContent,
		description: input.description,
		createdBy: input.createdBy,
	});
}

// ============================================
// High-level service methods (with access control)
// ============================================

/**
 * List secret files for a configuration with access checks.
 */
export async function listForConfiguration(
	orgId: string,
	configurationId: string,
): Promise<SecretFileMeta[]> {
	await assertConfigurationAccess(configurationId, orgId);
	return secretFilesDb.listByConfiguration(orgId, configurationId);
}

/**
 * Upsert a secret file with role + config ownership checks.
 */
export async function upsertForOrg(input: {
	organizationId: string;
	configurationId: string;
	filePath: string;
	content: string;
	description?: string | null;
	createdBy: string;
	userId: string;
}): Promise<SecretFileMeta> {
	await assertAdminOrOwner(input.userId, input.organizationId);
	await assertConfigurationAccess(input.configurationId, input.organizationId);
	return upsertSecretFile({
		organizationId: input.organizationId,
		configurationId: input.configurationId,
		filePath: input.filePath,
		content: input.content,
		description: input.description,
		createdBy: input.createdBy,
	});
}

/**
 * Delete a secret file with role checks.
 */
export async function deleteForOrg(id: string, orgId: string, userId: string): Promise<void> {
	await assertAdminOrOwner(userId, orgId);
	const deleted = await secretFilesDb.deleteById(id, orgId);
	if (!deleted) {
		throw new SecretFileNotFoundError();
	}
}

// ============================================
// Sandbox Apply
// ============================================

const SANDBOX_WORKSPACE_ROOT = "/home/user/workspace";
const SECRET_FILE_WRITE_TIMEOUT_MS = 15_000;
const WRITE_SECRET_FILE_SCRIPT = `
set -eu
target="$PROLIFERATE_SECRET_FILE_TARGET"
mkdir -p "$(dirname "$target")"
printf '%s' "$PROLIFERATE_SECRET_FILE_CONTENT_B64" | base64 -d > "$target"
`;

/**
 * Apply a secret file to an active sandbox session at runtime.
 */
export async function applyToActiveSession(params: {
	orgId: string;
	sessionId: string;
	configurationId: string;
	filePath: string;
	content: string;
}): Promise<void> {
	const { orgId, sessionId, configurationId, filePath, content } = params;
	const session = await sessionsModule.getFullSession(sessionId, orgId);
	if (!session) {
		throw new SecretFileApplyError("Session not found");
	}
	if (!session.sandboxId) {
		throw new SecretFileApplyError("Session has no active sandbox");
	}
	if (session.configurationId !== configurationId) {
		throw new SecretFileApplyError(
			"Session configuration does not match secret file configuration",
		);
	}

	const provider = getSandboxProvider(session.sandboxProvider as SandboxProviderType);
	const execCommand = provider.execCommand;
	if (!execCommand) {
		throw new SecretFileApplyError("Sandbox provider does not support runtime file writes");
	}

	const relativePath = normalizeSecretFilePath(filePath);
	const targetPath = path.posix.join(SANDBOX_WORKSPACE_ROOT, relativePath);
	const contentBase64 = Buffer.from(content, "utf8").toString("base64");

	const result = await execCommand.call(
		provider,
		session.sandboxId,
		["sh", "-lc", WRITE_SECRET_FILE_SCRIPT],
		{
			timeoutMs: SECRET_FILE_WRITE_TIMEOUT_MS,
			env: {
				PROLIFERATE_SECRET_FILE_TARGET: targetPath,
				PROLIFERATE_SECRET_FILE_CONTENT_B64: contentBase64,
			},
		},
	);

	if (result.exitCode !== 0) {
		throw new SecretFileApplyError(
			`Failed to apply secret file to sandbox: exit code ${result.exitCode}`,
		);
	}

	logger.info(
		{ orgId, sessionId, configurationId, filePath },
		"Applied secret file to active sandbox",
	);
}
