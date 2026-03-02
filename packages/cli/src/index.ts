#!/usr/bin/env node

/**
 * Proliferate CLI
 *
 * Interactive mode (no namespace):
 *   proliferate         → auth → config → session → sync → opencode
 *   proliferate reset   → clear all state
 *
 * Command mode (namespace commands, used inside sandbox):
 *   proliferate session info|status|capabilities
 *   proliferate manager child spawn|list|inspect|message|cancel
 *   proliferate source list-bindings|query|get
 *   proliferate action invoke|status
 *   proliferate baseline info|targets
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
import { handleActionCommand } from "./commands/action.ts";
import { handleBaselineCommand } from "./commands/baseline.ts";
import { handleManagerCommand } from "./commands/manager.ts";
import { handleSessionCommand } from "./commands/session.ts";
import { handleSourceCommand } from "./commands/source.ts";
import { CLI_VERSION } from "./lib/constants.ts";
import { errorEnvelope, printEnvelope } from "./lib/envelope.ts";
import { CliError, ExitCode } from "./lib/exit-codes.ts";
import { main } from "./main.ts";
import { getProliferateDir } from "./state/config.ts";

const args = process.argv.slice(2);
const [namespace, ...rest] = args;

// Handle --version and --help
if (args.includes("--version") || args.includes("-v")) {
	console.log(CLI_VERSION);
	process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
	console.log(`
${chalk.bold("Proliferate CLI")} v${CLI_VERSION}

${chalk.dim("Interactive:")}
  proliferate              Start a coding session
  proliferate reset        Clear all state and credentials

${chalk.dim("Commands (sandbox mode):")}
  session info             Current session metadata
  session status           Runtime/operator status
  session capabilities     List allowed tools
  manager child spawn      Spawn child task session
  manager child list       List children for current run
  manager child inspect    Child session detail
  manager child message    Send message to child
  manager child cancel     Cancel child
  source list-bindings     List source bindings
  source query             Paginated source query
  source get               Single source detail
  action invoke            Invoke an action
  action status            Action invocation status
  baseline info            Current baseline metadata
  baseline targets         List targets

${chalk.dim("Options:")}
  --version, -v            Show version
  --help, -h               Show this help
`);
	process.exit(0);
}

/**
 * Run a namespace command. Catches CliError and prints envelope + exit code.
 */
async function runCommand(handler: () => Promise<number>): Promise<never> {
	try {
		const exitCode = await handler();
		process.exit(exitCode);
	} catch (err) {
		if (err instanceof CliError) {
			printEnvelope(errorEnvelope(err.message, {}));
			process.exit(err.exitCode);
		}
		const message = err instanceof Error ? err.message : String(err);
		printEnvelope(errorEnvelope(message, {}));
		process.exit(ExitCode.Terminal);
	}
}

// Route to namespace commands
switch (namespace) {
	case "session":
		runCommand(() => handleSessionCommand(rest));
		break;

	case "manager":
		runCommand(() => handleManagerCommand(rest));
		break;

	case "source":
		runCommand(() => handleSourceCommand(rest));
		break;

	case "action":
		runCommand(() => handleActionCommand(rest));
		break;

	case "baseline":
		runCommand(() => handleBaselineCommand(rest));
		break;

	case "reset": {
		const dir = getProliferateDir();
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
			console.log(chalk.green("✓ All Proliferate data cleared"));
		} else {
			console.log(chalk.dim("Nothing to reset"));
		}
		process.exit(0);
		break;
	}

	default:
		// Interactive mode: auth → config → session → sync → opencode
		main().catch((err) => {
			console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
			process.exit(1);
		});
		break;
}
