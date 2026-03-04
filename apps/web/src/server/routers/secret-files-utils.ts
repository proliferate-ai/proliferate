/**
 * Secret file path utilities.
 *
 * Pure path validation extracted here so unit tests can import it
 * without pulling in the full services dependency tree.
 * The canonical service-layer version lives in @proliferate/services secret-files service.
 */

import path from "node:path";

/**
 * Normalize and validate a secret file path for sandbox use.
 * Must be a relative path under the workspace root.
 */
export function normalizeSecretFilePathForSandbox(filePath: string): string {
	const trimmed = filePath.trim();
	if (!trimmed) {
		throw new Error("Secret file path is required");
	}
	if (trimmed.includes("\0")) {
		throw new Error("Secret file path contains invalid characters");
	}
	const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
	if (path.posix.isAbsolute(normalized) || normalized.startsWith("..")) {
		throw new Error("Secret file path must be a relative path under workspace");
	}
	return normalized;
}
