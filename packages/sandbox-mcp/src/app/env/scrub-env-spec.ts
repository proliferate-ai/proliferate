import { existsSync, unlinkSync } from "node:fs";
import { resolveWorkspacePath, safePath } from "../../domain/env/path-policy.js";
import { sandboxEnv } from "../../env.js";
import type { EnvFileSpec } from "./types.js";

const PROLIFERATE_ENV_FILE = "/tmp/.proliferate_env.json";

export function scrubEnvSpec(spec: EnvFileSpec[]): { scrubbed: string[] } {
	const scrubbed: string[] = [];
	const workspaceDir = sandboxEnv.workspaceDir;

	for (const entry of spec) {
		if (entry.mode !== "secret") continue;
		const repoDir = resolveWorkspacePath(workspaceDir, entry.workspacePath);
		const filePath = safePath(repoDir, entry.path);
		if (!existsSync(filePath)) continue;
		unlinkSync(filePath);
		scrubbed.push(entry.path);
	}

	if (existsSync(PROLIFERATE_ENV_FILE)) {
		unlinkSync(PROLIFERATE_ENV_FILE);
		scrubbed.push(PROLIFERATE_ENV_FILE);
	}

	return { scrubbed };
}
