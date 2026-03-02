/**
 * Action Namespace Commands
 *
 * proliferate action invoke --tool <id> --input <json> --idempotency-key <key>
 * proliferate action status --invocation <id>
 *
 * Returns pending_approval with exit code 4 when approval is required.
 */

import { printEnvelope } from "../lib/envelope.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";
import { gatewayRequest, parseFlags } from "../lib/gateway-client.ts";

async function invoke(flags: Record<string, string>): Promise<number> {
	const tool = flags.tool;
	const input = flags.input;
	const idempotencyKey = flags["idempotency-key"];

	if (!tool) {
		throw new CliError("--tool is required for action invoke", ExitCode.Validation, "missing_tool");
	}
	if (!input) {
		throw new CliError(
			"--input is required for action invoke",
			ExitCode.Validation,
			"missing_input",
		);
	}
	if (!idempotencyKey) {
		throw new CliError(
			"--idempotency-key is required for action invoke",
			ExitCode.Validation,
			"missing_idempotency_key",
		);
	}

	let params: Record<string, unknown>;
	try {
		params = JSON.parse(input);
	} catch {
		throw new CliError("--input must be valid JSON", ExitCode.Validation, "invalid_json");
	}

	// Parse tool as integration:action
	const [integration, action] = tool.includes(":") ? tool.split(":", 2) : [tool, tool];

	const { envelope, exitCode } = await gatewayRequest("/proliferate/:sessionId/actions/invoke", {
		method: "POST",
		headers: { "Idempotency-Key": idempotencyKey },
		body: JSON.stringify({ integration, action, params }),
	});

	printEnvelope(envelope);
	return exitCode;
}

async function status(flags: Record<string, string>): Promise<number> {
	const invocationId = flags.invocation;
	if (!invocationId) {
		throw new CliError(
			"--invocation is required for action status",
			ExitCode.Validation,
			"missing_invocation",
		);
	}

	const { envelope, exitCode } = await gatewayRequest(
		`/proliferate/:sessionId/actions/invocations/${encodeURIComponent(invocationId)}`,
	);
	printEnvelope(envelope);
	return exitCode;
}

export async function handleActionCommand(args: string[]): Promise<number> {
	const [subcommand, ...rest] = args;
	const flags = parseFlags(rest);

	switch (subcommand) {
		case "invoke":
			return invoke(flags);
		case "status":
			return status(flags);
		default:
			throw new CliError(
				`Unknown action command: ${subcommand ?? "(none)"}. Available: invoke, status`,
				ExitCode.Validation,
				"unknown_command",
			);
	}
}
