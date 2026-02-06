/**
 * E2B Integration Test
 *
 * Tests E2B sandbox creation, operations, and cleanup.
 * Supports both E2B Cloud and self-hosted configurations.
 *
 * Usage:
 *   # E2B Cloud
 *   E2B_API_KEY=xxx pnpm tsx scripts/test-e2b.ts
 *
 *   # Self-hosted
 *   E2B_API_KEY=xxx E2B_DOMAIN=e2b.company.com pnpm tsx scripts/test-e2b.ts
 */

import { env } from "@proliferate/environment/server";
import { Sandbox } from "e2b";

const TEMPLATE = env.E2B_TEMPLATE;
const DOMAIN = env.E2B_DOMAIN;

interface TestResult {
	name: string;
	passed: boolean;
	duration: number;
	error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<boolean> {
	const start = Date.now();
	try {
		await fn();
		results.push({ name, passed: true, duration: Date.now() - start });
		console.log(`   ✓ ${name} (${Date.now() - start}ms)`);
		return true;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		results.push({
			name,
			passed: false,
			duration: Date.now() - start,
			error: errorMsg,
		});
		console.log(`   ✗ ${name}: ${errorMsg}`);
		return false;
	}
}

async function main() {
	console.log("E2B Integration Test");
	console.log("====================\n");

	if (!env.E2B_API_KEY) {
		console.error("Error: E2B_API_KEY environment variable is required");
		process.exit(1);
	}
	if (!TEMPLATE) {
		console.error("Error: E2B_TEMPLATE environment variable is required");
		process.exit(1);
	}

	console.log(`Template: ${TEMPLATE}`);
	if (DOMAIN) {
		console.log(`Domain: ${DOMAIN} (self-hosted)`);
	} else {
		console.log("Domain: E2B Cloud");
	}
	console.log("");

	// Build sandbox options
	const sandboxOpts: Parameters<typeof Sandbox.create>[1] = {
		timeoutMs: 300000, // 5 minutes
	};
	if (DOMAIN) {
		// @ts-expect-error - domain option exists in E2B SDK for self-hosted
		sandboxOpts.domain = DOMAIN;
	}

	let sandbox: Sandbox | null = null;
	let pausedSandboxId: string | null = null;

	try {
		// Test 1: Create sandbox
		console.log("1. Sandbox Creation");
		await runTest("Create sandbox", async () => {
			sandbox = await Sandbox.create(TEMPLATE, sandboxOpts);
			if (!sandbox?.sandboxId) {
				throw new Error("Sandbox ID not returned");
			}
		});

		if (!sandbox) {
			throw new Error("Sandbox creation failed, cannot continue tests");
		}

		// Test 2: Run command
		console.log("\n2. Command Execution");
		await runTest("Run echo command", async () => {
			const result = await sandbox!.commands.run("echo 'Hello from E2B'");
			if (result.stdout.trim() !== "Hello from E2B") {
				throw new Error(`Unexpected output: ${result.stdout}`);
			}
		});

		await runTest("Check environment variables", async () => {
			const result = await sandbox!.commands.run("env | grep -c PATH");
			if (Number.parseInt(result.stdout.trim(), 10) < 1) {
				throw new Error("PATH not found in environment");
			}
		});

		// Test 3: File operations
		console.log("\n3. File Operations");
		await runTest("Write file", async () => {
			await sandbox!.files.write("/tmp/test.txt", "E2B test content");
		});

		await runTest("Read file", async () => {
			const content = await sandbox!.files.read("/tmp/test.txt");
			if (content.trim() !== "E2B test content") {
				throw new Error(`Unexpected content: ${content}`);
			}
		});

		// Test 4: Services
		console.log("\n4. Pre-installed Services");
		await runTest("PostgreSQL ready", async () => {
			const result = await sandbox!.commands.run("pg_isready", {
				timeoutMs: 10000,
			});
			if (result.exitCode !== 0) {
				throw new Error(`pg_isready failed: ${result.stderr}`);
			}
		});

		await runTest("Redis ping", async () => {
			const result = await sandbox!.commands.run("redis-cli ping", {
				timeoutMs: 5000,
			});
			if (result.stdout.trim() !== "PONG") {
				throw new Error(`Redis ping failed: ${result.stdout}`);
			}
		});

		// Test 5: Docker (E2B-specific feature)
		console.log("\n5. Docker Support");
		await runTest("Docker available", async () => {
			const result = await sandbox!.commands.run("docker --version", {
				timeoutMs: 10000,
			});
			if (result.exitCode !== 0) {
				throw new Error("Docker not available");
			}
		});

		await runTest("Docker Compose available", async () => {
			const result = await sandbox!.commands.run("docker-compose --version", {
				timeoutMs: 10000,
			});
			if (result.exitCode !== 0) {
				throw new Error("Docker Compose not available");
			}
		});

		// Test 6: Development tools
		console.log("\n6. Development Tools");
		await runTest("Node.js version", async () => {
			const result = await sandbox!.commands.run("node --version");
			if (!result.stdout.includes("v20")) {
				throw new Error(`Unexpected Node version: ${result.stdout}`);
			}
		});

		await runTest("Python version", async () => {
			const result = await sandbox!.commands.run("python3 --version");
			if (!result.stdout.includes("3.11")) {
				throw new Error(`Unexpected Python version: ${result.stdout}`);
			}
		});

		await runTest("pnpm available", async () => {
			const result = await sandbox!.commands.run("pnpm --version");
			if (result.exitCode !== 0) {
				throw new Error("pnpm not available");
			}
		});

		await runTest("OpenCode CLI available", async () => {
			const result = await sandbox!.commands.run("opencode --version");
			if (result.exitCode !== 0) {
				throw new Error("OpenCode CLI not available");
			}
		});

		// Test 7: Pre-installed dependencies
		console.log("\n7. Pre-installed Dependencies");
		await runTest("AWS SDK pre-installed", async () => {
			const result = await sandbox!.commands.run(
				"ls /home/user/.opencode-tools/node_modules/@aws-sdk",
			);
			if (result.exitCode !== 0) {
				throw new Error("AWS SDK not pre-installed");
			}
		});

		await runTest("Proliferate metadata directory exists", async () => {
			const result = await sandbox!.commands.run("ls -la /home/user/.proliferate");
			if (result.exitCode !== 0) {
				throw new Error("Proliferate metadata directory not found");
			}
		});

		// Test 8: Pause/Resume
		console.log("\n8. Pause/Resume (Snapshot)");
		await runTest("Write state before pause", async () => {
			await sandbox!.files.write("/tmp/state.txt", "state-before-pause");
		});

		await runTest("Pause sandbox", async () => {
			pausedSandboxId = sandbox!.sandboxId;
			await Sandbox.betaPause(pausedSandboxId);
		});

		await runTest("Resume sandbox", async () => {
			sandbox = await Sandbox.connect(pausedSandboxId!);
			if (!sandbox?.sandboxId) {
				throw new Error("Failed to resume sandbox");
			}
		});

		await runTest("Verify state after resume", async () => {
			const content = await sandbox!.files.read("/tmp/state.txt");
			if (content.trim() !== "state-before-pause") {
				throw new Error(`State not preserved: ${content}`);
			}
		});

		// Test 9: Tunnel URLs
		console.log("\n9. Tunnel URLs");
		await runTest("Get port 4096 tunnel", async () => {
			const host = sandbox!.getHost(4096);
			if (!host) {
				throw new Error("No tunnel URL for port 4096");
			}
		});

		await runTest("Get port 20000 tunnel (preview)", async () => {
			const host = sandbox!.getHost(20000);
			if (!host) {
				throw new Error("No tunnel URL for port 20000");
			}
		});
	} finally {
		// Cleanup
		console.log("\n10. Cleanup");
		if (sandbox) {
			await runTest("Terminate sandbox", async () => {
				await Sandbox.kill(sandbox!.sandboxId);
			});
		}
	}

	// Summary
	console.log(`\n${"=".repeat(50)}`);
	console.log("Test Summary");
	console.log("=".repeat(50));

	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed).length;
	const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

	console.log(`\nPassed: ${passed}/${results.length}`);
	console.log(`Failed: ${failed}/${results.length}`);
	console.log(`Total time: ${(totalDuration / 1000).toFixed(1)}s`);

	if (failed > 0) {
		console.log("\nFailed tests:");
		for (const result of results.filter((r) => !r.passed)) {
			console.log(`  - ${result.name}: ${result.error}`);
		}
		process.exit(1);
	}

	console.log("\nAll tests passed!");
}

main().catch((err) => {
	console.error("\nTest failed with error:", err);
	process.exit(1);
});
