import { FileType, Sandbox } from "e2b";
import { ENV_FILE } from "../../../opencode-tools";
import { SANDBOX_TIMEOUT_MS, capOutput, shellEscape } from "../../../sandbox";
import type { FileContent } from "../../types";
import { getE2BConnectOpts } from "../shared/config";

/** Resolves OpenCode and preview tunnel URLs for an existing sandbox. */
export async function resolveTunnelUrls(
	sandboxId: string,
): Promise<{ openCodeUrl: string; previewUrl: string }> {
	const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());
	const tunnelHost = sandbox.getHost(4096);
	const previewHost = sandbox.getHost(20000);
	return {
		openCodeUrl: tunnelHost ? `https://${tunnelHost}` : "",
		previewUrl: previewHost ? `https://${previewHost}` : "",
	};
}

/** Merges env vars into the sandbox `.env` file without dropping existing keys. */
export async function writeSandboxEnvFile(
	sandboxId: string,
	envVars: Record<string, string>,
): Promise<void> {
	const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());

	let existing: Record<string, string> = {};
	try {
		const existingJson = await sandbox.files.read(ENV_FILE);
		if (existingJson.trim()) {
			existing = JSON.parse(existingJson);
		}
	} catch {
		// File doesn't exist yet
	}

	await sandbox.files.write(ENV_FILE, JSON.stringify({ ...existing, ...envVars }));
}

/**
 * Executes an argv command inside a sandbox via shell-escaped string execution.
 * Output is capped to keep API payloads bounded.
 */
export async function execSandboxCommand(
	sandboxId: string,
	argv: string[],
	opts?: {
		cwd?: string;
		timeoutMs?: number;
		env?: Record<string, string>;
	},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());
	const timeoutSec = Math.ceil((opts?.timeoutMs ?? 30_000) / 1000);
	// E2B's commands.run() only accepts a shell string, not argv.
	// We shellEscape each argument to maintain the no-injection contract.
	const escapedArgs = ["timeout", String(timeoutSec), ...argv].map(shellEscape).join(" ");
	const cmd = opts?.cwd ? `cd ${shellEscape(opts.cwd)} && ${escapedArgs}` : escapedArgs;

	const result = await sandbox.commands.run(cmd, {
		timeoutMs: (opts?.timeoutMs ?? 30_000) + 5_000,
		envs: opts?.env,
	});
	return {
		stdout: capOutput(result.stdout),
		stderr: capOutput(result.stderr),
		exitCode: result.exitCode,
	};
}

/** Recursively reads all files in a sandbox folder as byte payloads. */
export async function readSandboxFiles(
	sandboxId: string,
	folderPath: string,
): Promise<FileContent[]> {
	const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());
	const exists = await sandbox.files.exists(folderPath);
	if (!exists) {
		return [];
	}

	const normalizedFolder = folderPath.replace(/\/$/, "");
	const files: FileContent[] = [];
	const directories: string[] = [normalizedFolder];

	while (directories.length > 0) {
		const dir = directories.pop();
		if (!dir) break;

		const entries = await sandbox.files.list(dir).catch(() => null);
		if (!entries) {
			continue;
		}

		for (const entry of entries) {
			if (entry.type === FileType.DIR) {
				directories.push(entry.path);
				continue;
			}
			if (entry.type !== FileType.FILE) {
				continue;
			}

			try {
				const data = await sandbox.files.read(entry.path, { format: "bytes" });
				const relativePath = entry.path.replace(`${normalizedFolder}/`, "");
				files.push({ path: relativePath, data });
			} catch {
				// Best-effort reads only.
			}
		}
	}
	return files;
}

/** Computes absolute sandbox expiration timestamp from creation time. */
export function buildCreateSandboxExpiresAt(createdAtMs: number): number {
	return createdAtMs + SANDBOX_TIMEOUT_MS;
}
