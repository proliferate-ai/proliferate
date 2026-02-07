/**
 * OpenCode Agent
 *
 * Find and launch the bundled OpenCode binary.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeEnv } from "@proliferate/environment/runtime";
import chalk from "chalk";

/**
 * Get the path to the bundled opencode binary for the current platform.
 *
 * Binaries are expected at:
 * - packages/cli/bin/opencode-darwin-arm64
 * - packages/cli/bin/opencode-darwin-x64
 * - packages/cli/bin/opencode-linux-arm64
 * - packages/cli/bin/opencode-linux-x64
 */
export function getOpenCodeBinaryPath(): string {
	const platform = process.platform === "darwin" ? "darwin" : "linux";
	const arch = process.arch === "arm64" ? "arm64" : "x64";
	const binaryName = `opencode-${platform}-${arch}`;

	// Try relative to this file first (development)
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const devPath = join(__dirname, "..", "..", "bin", binaryName);
	if (existsSync(devPath)) {
		return devPath;
	}

	// Try relative to the CLI binary (installed via npm/curl)
	const installedPath = join(dirname(process.execPath), "bin", binaryName);
	if (existsSync(installedPath)) {
		return installedPath;
	}

	// Try in the same directory as the CLI binary
	const sameDirPath = join(dirname(process.execPath), binaryName);
	if (existsSync(sameDirPath)) {
		return sameDirPath;
	}

	throw new Error("Coding agent binary not found. Please reinstall proliferate.");
}

/**
 * Launch OpenCode in attach mode
 */
export function launchOpenCode(attachUrl: string): Promise<number> {
	return new Promise((resolve, reject) => {
		let opencodePath: string;
		try {
			opencodePath = getOpenCodeBinaryPath();
		} catch (err) {
			reject(err);
			return;
		}

		const opencode = spawn(opencodePath, ["attach", attachUrl], {
			stdio: "inherit",
			env: runtimeEnv,
		});

		opencode.on("error", (err) => {
			console.error(chalk.red(`Failed to start coding agent: ${err.message}`));
			reject(err);
		});

		opencode.on("exit", (code) => {
			resolve(code ?? 0);
		});
	});
}
