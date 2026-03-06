import { applyEnvSpec } from "../../app/env/apply-env-spec.js";
import { scrubEnvSpec } from "../../app/env/scrub-env-spec.js";
import type { EnvFileSpec } from "../../app/env/types.js";
import { CliError } from "../errors.js";
import type { CliFlags } from "../flags.js";
import { requireFlag } from "../flags.js";
import { writeJson } from "../output.js";

function parseSpec(flags: CliFlags): EnvFileSpec[] {
	const raw = requireFlag(flags, "spec");
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			throw new CliError("--spec must be a JSON array", 2);
		}
		return parsed as EnvFileSpec[];
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new CliError(`Invalid JSON in --spec: ${error.message}`, 2);
		}
		throw error;
	}
}

export async function envApply(flags: CliFlags): Promise<void> {
	writeJson(applyEnvSpec(parseSpec(flags)));
}

export async function envScrub(flags: CliFlags): Promise<void> {
	writeJson(scrubEnvSpec(parseSpec(flags)));
}
