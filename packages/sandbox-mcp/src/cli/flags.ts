import { CliError } from "./errors.js";

export type CliFlags = Record<string, string | boolean>;

export function parseFlags(args: string[]): CliFlags {
	const flags: CliFlags = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--follow") {
			flags.follow = true;
		} else if (arg.startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
			flags[arg.slice(2)] = args[i + 1];
			i++;
		}
	}
	return flags;
}

export function requireFlag(flags: CliFlags, key: string): string {
	const value = flags[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new CliError(`Missing required flag: --${key}`, 2);
	}
	return value;
}
