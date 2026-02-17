/**
 * Main Flow
 *
 * The ONE flow: auth → config → session → sync → opencode
 */

import { basename } from "node:path";
import { createOpenCodeClient, createSyncClient } from "@proliferate/gateway-clients";
import chalk from "chalk";
import ora from "ora";
import { launchOpenCode } from "./agents/opencode.ts";
import { GATEWAY_URL } from "./lib/constants.ts";
import { getSSHKeyInfo, hashPrebuildPath } from "./lib/ssh.ts";
import { CONFIG_SYNC_JOBS, FileSyncer } from "./lib/sync.ts";
import { ensureAuth } from "./state/auth.ts";
import { ensureConfig } from "./state/config.ts";

/**
 * The main proliferate flow
 */
export async function main(): Promise<void> {
	const cwd = process.cwd();

	// 1. Ensure auth (device flow if needed, health check if exists)
	const auth = await ensureAuth();

	// 2. Ensure config
	const config = ensureConfig();

	// 3. Create gateway client
	const client = createSyncClient({
		baseUrl: GATEWAY_URL,
		auth: { type: "token", token: auth.token },
		source: "cli",
	});

	// 4. Create session
	const sessionSpinner = ora("Creating session...").start();

	let session: {
		sessionId: string;
		sandbox?: { sshHost?: string; sshPort?: number };
	};

	try {
		const sshKeyInfo = getSSHKeyInfo();

		session = await client.createSession({
			organizationId: auth.org.id,
			cliConfiguration: {
				localPathHash: hashPrebuildPath(cwd),
				displayName: basename(cwd),
			},
			sessionType: "cli",
			clientType: "cli",
			sandboxMode: "immediate",
			agentConfig: config.modelId ? { modelId: config.modelId } : undefined,
			sshOptions: {
				publicKeys: [sshKeyInfo.publicKey],
			},
		});

		sessionSpinner.succeed("Session ready");
	} catch (err) {
		sessionSpinner.fail("Failed to create session");
		console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
		process.exit(1);
	}

	// sandboxMode: "immediate" means sandbox is ready in response
	const sshHost = session.sandbox?.sshHost;
	const sshPort = session.sandbox?.sshPort;

	if (!sshHost || !sshPort) {
		console.error(chalk.red("Sandbox SSH not available"));
		process.exit(1);
	}

	// 5. Sync workspace and config
	const syncSpinner = ora("Syncing...").start();

	try {
		const syncer = new FileSyncer({ host: sshHost, port: sshPort });

		await syncer.sync(
			[
				// Workspace (main project)
				{
					local: cwd,
					remote: "/home/user/workspace",
					delete: true,
					respectGitignore: true,
				},
				// Config files from home directory
				...CONFIG_SYNC_JOBS,
			],
			(p) => {
				syncSpinner.text = `${p.message} ${p.percent}%`;
			},
		);

		syncSpinner.succeed("Synced");
	} catch (err) {
		syncSpinner.warn(`Sync warning: ${err instanceof Error ? err.message : err}`);
		// Continue anyway - sandbox might still work
	}

	// 6. Get OpenCode attach URL
	const opencode = createOpenCodeClient({
		baseUrl: GATEWAY_URL,
		auth: { type: "token", token: auth.token },
	});

	const attachUrl = await opencode.getUrl(session.sessionId);

	// 7. Launch opencode
	console.log();
	console.log(chalk.dim(`Session: ${session.sessionId.slice(0, 8)}`));
	console.log();

	const exitCode = await launchOpenCode(attachUrl);
	process.exit(exitCode);
}
