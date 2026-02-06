/**
 * Auth State Management
 *
 * Handles auth storage, device flow login, and token validation.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { createSyncClient } from "@proliferate/gateway-clients";
import chalk from "chalk";
import open from "open";
import ora from "ora";
import { GATEWAY_URL } from "../lib/constants.ts";
import { generateSSHKey, getSSHKeyInfo, hasSSHKey } from "../lib/ssh.ts";
import { ensureDir, getConfig, getProliferateDir } from "./config.ts";

const TOKEN_FILE = join(getProliferateDir(), "token");

export interface StoredAuth {
	token: string;
	user: {
		id: string;
		email: string;
		name?: string;
	};
	org: {
		id: string;
		name: string;
	};
}

/**
 * Get stored auth, or null if not logged in
 */
export function getAuth(): StoredAuth | null {
	if (!existsSync(TOKEN_FILE)) {
		return null;
	}
	try {
		return JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
	} catch {
		return null;
	}
}

/**
 * Save auth to disk
 */
export function saveAuth(auth: StoredAuth): void {
	ensureDir();
	writeFileSync(TOKEN_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

/**
 * Clear stored auth
 */
export function clearAuth(): void {
	if (existsSync(TOKEN_FILE)) {
		unlinkSync(TOKEN_FILE);
	}
}

/**
 * Ensure auth is valid. Runs device flow if needed, validates token if exists.
 */
export async function ensureAuth(): Promise<StoredAuth> {
	const stored = getAuth();

	if (!stored) {
		// No auth — run device flow
		return await deviceFlow();
	}

	// Verify token is still valid via gateway health check
	const client = createSyncClient({
		baseUrl: GATEWAY_URL,
		auth: { type: "token", token: stored.token },
	});

	const health = await client.checkHealth();

	if (!health.ok) {
		// Token expired — clear and re-auth
		clearAuth();
		console.log(chalk.yellow("\nSession expired. Please log in again.\n"));
		return await deviceFlow();
	}

	return stored;
}

/**
 * Device code authentication flow
 */
async function deviceFlow(): Promise<StoredAuth> {
	const config = getConfig();

	console.log(chalk.bold("\nWelcome to Proliferate!\n"));

	// Step 1: Request device code
	const spinner = ora("Requesting device code...").start();

	let deviceCode: string;
	let userCode: string;
	let verificationUrl: string;
	let interval: number;

	try {
		const response = await fetch(`${config.apiUrl}/api/cli/auth/device`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});

		if (!response.ok) {
			throw new Error(`Failed to connect: ${response.status}`);
		}

		const data = (await response.json()) as {
			deviceCode: string;
			userCode: string;
			verificationUrl: string;
			interval: number;
		};

		deviceCode = data.deviceCode;
		userCode = data.userCode;
		verificationUrl = data.verificationUrl;
		interval = data.interval;
		spinner.stop();
	} catch (err) {
		spinner.fail("Failed to connect to Proliferate API");
		console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
		console.log(chalk.dim(`\nAPI URL: ${config.apiUrl}`));
		process.exit(1);
	}

	// Display the code
	console.log();
	console.log(chalk.cyan("  ! Visit: ") + chalk.bold.white(verificationUrl));
	console.log(chalk.cyan("  ! Enter code: ") + chalk.bold.yellow(userCode));
	console.log();

	// Open browser
	await open(verificationUrl, { wait: false });
	console.log(chalk.dim("  (Browser opened automatically)\n"));

	// Poll for authorization
	const pollSpinner = ora("Waiting for authorization...").start();
	const maxAttempts = 180; // 15 minutes at 5 second intervals
	let attempts = 0;
	let auth: StoredAuth | null = null;

	while (attempts < maxAttempts) {
		await sleep(interval * 1000);
		attempts++;

		try {
			const response = await fetch(`${config.apiUrl}/api/cli/auth/device/poll`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deviceCode }),
			});

			const pollData = (await response.json()) as {
				token?: string;
				user?: { id: string; email: string; name?: string };
				org?: { id: string; name: string };
				error?: string;
			};

			if (pollData.error === "authorization_pending") {
				continue;
			}

			if (pollData.error) {
				pollSpinner.fail(`Authorization failed: ${pollData.error}`);
				process.exit(1);
			}

			if (pollData.token && pollData.user && pollData.org) {
				auth = {
					token: pollData.token,
					user: {
						id: pollData.user.id,
						email: pollData.user.email,
						name: pollData.user.name,
					},
					org: {
						id: pollData.org.id,
						name: pollData.org.name,
					},
				};

				saveAuth(auth);
				pollSpinner.succeed(
					`Logged in as ${chalk.bold(pollData.user.email)} (${pollData.org.name})`,
				);
				break;
			}
		} catch {
			// Network error, continue polling
		}
	}

	if (!auth) {
		pollSpinner.fail("Authorization timed out. Please try again.");
		process.exit(1);
	}

	// Step 2: Generate and upload SSH key
	console.log();
	const sshSpinner = ora("Setting up SSH key...").start();

	try {
		let keyInfo: { publicKey: string; fingerprint: string };
		if (hasSSHKey()) {
			keyInfo = getSSHKeyInfo();
			sshSpinner.text = "Using existing SSH key...";
		} else {
			keyInfo = generateSSHKey();
		}

		// Upload public key to API
		const response = await fetch(`${config.apiUrl}/api/cli/ssh-keys`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${auth.token}`,
			},
			body: JSON.stringify({
				publicKey: keyInfo.publicKey,
				fingerprint: keyInfo.fingerprint,
				name: `${hostname()}-cli`,
			}),
		});

		if (!response.ok) {
			const data = (await response.json()) as { error?: string };
			if (data.error?.includes("already registered")) {
				sshSpinner.succeed("SSH key already registered");
			} else {
				throw new Error(data.error || "Failed to upload SSH key");
			}
		} else {
			sshSpinner.succeed("SSH key configured");
		}
	} catch (err) {
		if (err instanceof Error && err.message.includes("already registered")) {
			sshSpinner.succeed("SSH key already registered");
		} else {
			sshSpinner.fail("Failed to configure SSH key");
			console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : err}`));
			// Non-fatal, continue
		}
	}

	console.log(chalk.green("\n✓ Ready to go!\n"));

	return auth;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
