/**
 * .env file parser and path safety utilities.
 *
 * Pure functions for parsing `.env.local`-style text and validating
 * target file paths for secret bundle injection.
 */

export interface EnvEntry {
	key: string;
	value: string;
}

/**
 * Parse `.env.local`-format text into key-value entries.
 *
 * Handles:
 * - KEY=VALUE
 * - KEY="double quoted value"
 * - KEY='single quoted value'
 * - export KEY=VALUE
 * - Comments (# ...) and blank lines are skipped
 * - Lines without `=` are skipped
 */
export function parseEnvFile(text: string): EnvEntry[] {
	const entries: EnvEntry[] = [];

	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();

		// Skip empty lines and comments
		if (!line || line.startsWith("#")) continue;

		// Strip optional `export ` prefix
		const stripped = line.startsWith("export ") ? line.slice(7) : line;

		// Find the first `=`
		const eqIndex = stripped.indexOf("=");
		if (eqIndex === -1) continue;

		const key = stripped.slice(0, eqIndex).trim();
		if (!key) continue;

		let value = stripped.slice(eqIndex + 1).trim();

		// Strip surrounding quotes (preserve inline # inside quoted values)
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		} else {
			// Strip inline comments from unquoted values
			const hashIndex = value.indexOf(" #");
			if (hashIndex !== -1) {
				value = value.slice(0, hashIndex).trimEnd();
			}
		}

		entries.push({ key, value });
	}

	return entries;
}

/**
 * Validate a relative file path for use as an env file target.
 *
 * Rejects absolute paths, `..` traversal, null bytes, and empty strings.
 * Mirrors the safety logic in `proliferate-cli.ts` `safePath()`.
 */
export function isValidTargetPath(path: string): boolean {
	if (!path) return false;
	if (path.includes("\0")) return false;
	if (path.startsWith("/")) return false;
	if (path.split("/").includes("..")) return false;
	// Reject paths that start with a drive letter (Windows-style)
	if (/^[a-zA-Z]:/.test(path)) return false;
	return true;
}
