import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { commandExists, runCommand } from "./command";
import { PULUMI_DIR } from "./paths";
import { type PromptInterface, promptConfirm } from "./prompts";

export async function ensurePulumiInstalled(rl: PromptInterface) {
	if (commandExists("pulumi")) return;
	const install = await promptConfirm(rl, "Pulumi CLI not found. Install now?");
	if (!install) {
		console.log("Pulumi is required to continue. Exiting.");
		process.exit(1);
	}

	if (process.platform === "darwin" && commandExists("brew")) {
		console.log("Installing Pulumi with Homebrew...");
		const result = runCommand("brew", ["install", "pulumi/tap/pulumi"], { stdio: "inherit" });
		if (result.status === 0) return;
		console.log("Homebrew install failed. Falling back to Pulumi install script...");
	}

	console.log("Installing Pulumi with the official installer...");
	const result = runCommand("bash", ["-lc", "curl -fsSL https://get.pulumi.com | sh"], {
		stdio: "inherit",
	});
	if (result.status !== 0) {
		console.log("Pulumi install failed. Please install Pulumi manually and rerun.");
		process.exit(1);
	}

	const pulumiBin = resolve(process.env.HOME ?? "~", ".pulumi/bin");
	if (existsSync(pulumiBin) && !process.env.PATH?.includes(pulumiBin)) {
		process.env.PATH = `${pulumiBin}:${process.env.PATH ?? ""}`;
	}
	if (!commandExists("pulumi")) {
		console.log("Pulumi is installed but not on PATH. Please add ~/.pulumi/bin to PATH.");
		process.exit(1);
	}
}

export function loginPulumiBackend(backendUrl: string, env: NodeJS.ProcessEnv) {
	console.log(`Pulumi backend: ${backendUrl}`);
	runCommand("pulumi", ["login", backendUrl], { env, stdio: "inherit" });
}

export function selectOrInitStack(stack: string, env: NodeJS.ProcessEnv): void {
	const select = runCommand("pulumi", ["stack", "select", stack], { cwd: PULUMI_DIR, env });
	if (select.status === 0) return;

	const init = runCommand("pulumi", ["stack", "init", stack], {
		cwd: PULUMI_DIR,
		env,
		stdio: "inherit",
	});
	if (init.status !== 0) {
		console.log("Failed to initialize Pulumi stack. Exiting.");
		process.exit(1);
	}
}

export function setPulumiConfig(
	entries: Array<{ key: string; value: string; secret?: boolean }>,
	env: NodeJS.ProcessEnv,
) {
	for (const { key, value, secret } of entries) {
		const args = ["config", "set", key, value];
		if (secret) args.push("--secret");
		runCommand("pulumi", args, { cwd: PULUMI_DIR, env, stdio: "inherit" });
	}
}

export function runPulumiUp(env: NodeJS.ProcessEnv): boolean {
	const up = runCommand("pulumi", ["up", "--yes"], { cwd: PULUMI_DIR, env, stdio: "inherit" });
	if (up.status !== 0) {
		console.log("Pulumi up failed. You can rerun it manually later.");
		return false;
	}
	return true;
}

export function readPulumiOutputs(env: NodeJS.ProcessEnv): Record<string, unknown> {
	const outputs = runCommand("pulumi", ["stack", "output", "--json"], { cwd: PULUMI_DIR, env });
	if (outputs.status === 0 && outputs.stdout) {
		try {
			return JSON.parse(outputs.stdout);
		} catch {
			return {};
		}
	}
	return {};
}

export function pulumiProjectExists(): boolean {
	return existsSync(resolve(PULUMI_DIR, "Pulumi.yaml"));
}
