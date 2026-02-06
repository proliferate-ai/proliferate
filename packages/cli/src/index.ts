#!/usr/bin/env node

/**
 * Proliferate CLI
 *
 * Two commands:
 * - proliferate         → main flow (auth → config → session → sync → opencode)
 * - proliferate reset   → clear all state
 */

// Windows check - must be first
if (process.platform === "win32") {
	console.error("\x1b[31mError: Proliferate CLI is not supported on Windows.\x1b[0m");
	console.error("\x1b[2mPlease use Windows Subsystem for Linux (WSL2) instead.\x1b[0m");
	console.error("\x1b[2m  https://docs.microsoft.com/en-us/windows/wsl/install\x1b[0m");
	process.exit(1);
}

import { existsSync, rmSync } from "node:fs";
import chalk from "chalk";
import { CLI_VERSION } from "./lib/constants.ts";
import { main } from "./main.ts";
import { clearAuth } from "./state/auth.ts";
import { getProliferateDir } from "./state/config.ts";

const args = process.argv.slice(2);
const command = args[0];

// Handle --version and --help
if (args.includes("--version") || args.includes("-v")) {
	console.log(CLI_VERSION);
	process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
	console.log(`
${chalk.bold("Proliferate CLI")} v${CLI_VERSION}

${chalk.dim("Usage:")}
  proliferate          Start a coding session
  proliferate reset    Clear all state and credentials

${chalk.dim("Options:")}
  --version, -v        Show version
  --help, -h           Show this help
`);
	process.exit(0);
}

// Handle reset command
if (command === "reset") {
	const dir = getProliferateDir();

	if (existsSync(dir)) {
		rmSync(dir, { recursive: true, force: true });
		console.log(chalk.green("✓ All Proliferate data cleared"));
	} else {
		console.log(chalk.dim("Nothing to reset"));
	}

	process.exit(0);
}

// Default: run main flow
// Ignore unknown commands - just run main
main().catch((err) => {
	console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
	process.exit(1);
});
