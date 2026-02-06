import type { createInterface } from "node:readline/promises";
import type { EnvState } from "./env";

export type PromptInterface = ReturnType<typeof createInterface>;

export type PromptOptions = {
	label?: string;
	defaultValue?: string;
	required?: boolean;
	secret?: boolean;
};

export async function promptInput(
	rl: PromptInterface,
	label: string,
	opts: { defaultValue?: string; required?: boolean } = {},
): Promise<string> {
	const suffix = opts.defaultValue ? ` [${opts.defaultValue}]` : "";
	const answer = (await rl.question(`${label}${suffix}: `)).trim();
	if (!answer && opts.defaultValue) return opts.defaultValue;
	if (!answer && opts.required) {
		return promptInput(rl, label, opts);
	}
	return answer;
}

export async function promptConfirm(
	rl: PromptInterface,
	label: string,
	defaultValue = true,
): Promise<boolean> {
	const hint = defaultValue ? "Y/n" : "y/N";
	const answer = (await rl.question(`${label} (${hint}): `)).trim().toLowerCase();
	if (!answer) return defaultValue;
	return ["y", "yes"].includes(answer);
}

export async function promptChoice(
	rl: PromptInterface,
	label: string,
	choices: string[],
	defaultValue?: string,
): Promise<string> {
	const options = choices.map((choice) => choice).join("/");
	const suffix = defaultValue ? ` [${defaultValue}]` : "";
	const answer = (await rl.question(`${label} (${options})${suffix}: `)).trim();
	if (!answer && defaultValue) return defaultValue;
	if (!choices.includes(answer)) {
		return promptChoice(rl, label, choices, defaultValue);
	}
	return answer;
}

export async function promptSecret(label: string, defaultValue?: string): Promise<string> {
	return new Promise((resolve) => {
		const stdin = process.stdin;
		const stdout = process.stdout;
		stdout.write(`${label}${defaultValue ? " [hidden]" : ""}: `);
		let value = "";
		const onData = (char: Buffer) => {
			const str = char.toString("utf8");
			if (str === "\n" || str === "\r" || str === "\u0004") {
				stdout.write("\n");
				stdin.setRawMode(false);
				stdin.pause();
				stdin.removeListener("data", onData);
				if (!value && defaultValue) resolve(defaultValue);
				else resolve(value);
				return;
			}
			if (str === "\u0003") {
				stdout.write("\n");
				process.exit(1);
			}
			if (str === "\u007f") {
				if (value.length > 0) {
					value = value.slice(0, -1);
					stdout.write("\b \b");
				}
				return;
			}
			value += str;
			stdout.write("*");
		};
		stdin.setRawMode(true);
		stdin.resume();
		stdin.on("data", onData);
	});
}

export async function promptSecretRequired(label: string, defaultValue?: string): Promise<string> {
	while (true) {
		const value = await promptSecret(label, defaultValue);
		if (value) return value;
		if (defaultValue) return defaultValue;
	}
}

export async function promptValue(
	rl: PromptInterface,
	key: string,
	opts: PromptOptions = {},
): Promise<string> {
	const label = opts.label ?? key;
	if (opts.secret) {
		if (opts.required) return promptSecretRequired(label, opts.defaultValue);
		return promptSecret(label, opts.defaultValue);
	}
	return promptInput(rl, label, { defaultValue: opts.defaultValue, required: opts.required });
}

export async function promptAndSet(
	rl: PromptInterface,
	envState: EnvState,
	key: string,
	opts: PromptOptions = {},
): Promise<string> {
	const value = await promptValue(rl, key, opts);
	envState.set(key, value);
	return value;
}
