/**
 * Source Namespace Commands
 *
 * proliferate source list-bindings                              — list worker source bindings
 * proliferate source query --binding <id> [--cursor] [--limit]  — paginated source query
 * proliferate source get --binding <id> --ref <ref>             — single source detail
 *
 * Capability-gated by source.<sourceType>.read
 */

import { printEnvelope } from "../lib/envelope.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";
import { gatewayRequest, parseFlags } from "../lib/gateway-client.ts";

async function listBindings(): Promise<number> {
	const { envelope, exitCode } = await gatewayRequest("/proliferate/:sessionId/sources/bindings");
	printEnvelope(envelope);
	return exitCode;
}

async function query(flags: Record<string, string>): Promise<number> {
	const binding = flags.binding;
	if (!binding) {
		throw new CliError(
			"--binding is required for source query",
			ExitCode.Validation,
			"missing_binding",
		);
	}

	const params = new URLSearchParams();
	if (flags.cursor) params.set("cursor", flags.cursor);
	if (flags.limit) params.set("limit", flags.limit);

	const qs = params.toString();
	const path = `/proliferate/:sessionId/sources/bindings/${encodeURIComponent(binding)}/query${qs ? `?${qs}` : ""}`;

	const { envelope, exitCode } = await gatewayRequest(path);
	printEnvelope(envelope);
	return exitCode;
}

async function get(flags: Record<string, string>): Promise<number> {
	const binding = flags.binding;
	const ref = flags.ref;

	if (!binding) {
		throw new CliError(
			"--binding is required for source get",
			ExitCode.Validation,
			"missing_binding",
		);
	}
	if (!ref) {
		throw new CliError("--ref is required for source get", ExitCode.Validation, "missing_ref");
	}

	const { envelope, exitCode } = await gatewayRequest(
		`/proliferate/:sessionId/sources/bindings/${encodeURIComponent(binding)}/refs/${encodeURIComponent(ref)}`,
	);
	printEnvelope(envelope);
	return exitCode;
}

export async function handleSourceCommand(args: string[]): Promise<number> {
	const [subcommand, ...rest] = args;
	const flags = parseFlags(rest);

	switch (subcommand) {
		case "list-bindings":
			return listBindings();
		case "query":
			return query(flags);
		case "get":
			return get(flags);
		default:
			throw new CliError(
				`Unknown source command: ${subcommand ?? "(none)"}. Available: list-bindings, query, get`,
				ExitCode.Validation,
				"unknown_command",
			);
	}
}
