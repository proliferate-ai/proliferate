import { spawnSync } from "node:child_process";
import { ROOT_DIR } from "./paths";

export function runCommand(
	command: string,
	args: string[],
	opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: "inherit" | "pipe" } = {},
) {
	const result = spawnSync(command, args, {
		cwd: opts.cwd ?? ROOT_DIR,
		env: { ...process.env, ...opts.env },
		stdio: opts.stdio ?? "pipe",
		encoding: "utf-8",
	});
	return result;
}

export function commandExists(command: string): boolean {
	const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
		stdio: "ignore",
	});
	return result.status === 0;
}
