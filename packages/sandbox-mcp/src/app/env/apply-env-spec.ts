import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CliError } from "../../cli/errors.js";
import { resolveWorkspacePath, safePath } from "../../domain/env/path-policy.js";
import { sandboxEnv } from "../../env.js";
import type { EnvFileSpec } from "./types.js";

const PROLIFERATE_ENV_FILE = "/tmp/.proliferate_env.json";

function addToGitExclude(repoDir: string, filePath: string): void {
	const excludeFile = join(repoDir, ".git", "info", "exclude");
	const excludeDir = dirname(excludeFile);
	if (!existsSync(join(repoDir, ".git"))) {
		return;
	}
	mkdirSync(excludeDir, { recursive: true });
	const existing = existsSync(excludeFile) ? readFileSync(excludeFile, "utf-8") : "";
	if (!existing.split("\n").includes(filePath)) {
		appendFileSync(
			excludeFile,
			`${existing.endsWith("\n") || existing === "" ? "" : "\n"}${filePath}\n`,
		);
	}
}

function loadEnvOverrides(): Record<string, string> {
	try {
		if (existsSync(PROLIFERATE_ENV_FILE)) {
			const data = JSON.parse(readFileSync(PROLIFERATE_ENV_FILE, "utf-8"));
			if (typeof data === "object" && data !== null) {
				const overrides: Record<string, string> = {};
				for (const [key, value] of Object.entries(data)) {
					if (typeof value === "string") {
						overrides[key] = value;
					}
				}
				return overrides;
			}
		}
	} catch {
		// Ignore parse/read errors and fallback to process env.
	}
	return {};
}

export function applyEnvSpec(spec: EnvFileSpec[]): {
	applied: Array<{ path: string; keyCount: number }>;
} {
	const envOverrides = loadEnvOverrides();
	const workspaceDir = sandboxEnv.workspaceDir;
	const missingKeys: string[] = [];
	const preparedWrites: Array<{
		repoDir: string;
		filePath: string;
		entryPath: string;
		lines: string[];
	}> = [];

	for (const entry of spec) {
		const repoDir = resolveWorkspacePath(workspaceDir, entry.workspacePath);
		const filePath = safePath(repoDir, entry.path);
		const lines: string[] = [];

		for (const { key, required } of entry.keys) {
			// biome-ignore lint/nursery/noProcessEnv: dynamic env lookup for user-defined keys
			const value = envOverrides[key] ?? process.env[key];
			if (value === undefined) {
				if (required) {
					missingKeys.push(key);
				}
				continue;
			}
			lines.push(`${key}=${value}`);
		}

		preparedWrites.push({ repoDir, filePath, entryPath: entry.path, lines });
	}

	if (missingKeys.length > 0) {
		throw new CliError(`Missing required environment variables: ${missingKeys.join(", ")}`, 1);
	}

	const applied: Array<{ path: string; keyCount: number }> = [];
	for (const entry of preparedWrites) {
		mkdirSync(dirname(entry.filePath), { recursive: true });
		writeFileSync(entry.filePath, `${entry.lines.join("\n")}\n`);
		addToGitExclude(entry.repoDir, entry.entryPath);
		applied.push({ path: entry.entryPath, keyCount: entry.lines.length });
	}

	return { applied };
}
