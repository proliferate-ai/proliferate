/**
 * Manager Namespace Commands
 *
 * proliferate manager child spawn     — spawn child task session
 * proliferate manager child list      — list children for current run
 * proliferate manager child inspect   — child session detail
 * proliferate manager child message   — send message to child
 * proliferate manager child cancel    — cancel child
 */

import { printEnvelope } from "../lib/envelope.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";
import { gatewayRequest, parseFlags } from "../lib/gateway-client.ts";

async function childSpawn(flags: Record<string, string>): Promise<number> {
	const input = flags.input;
	if (!input) {
		throw new CliError("--input is required for child spawn", ExitCode.Validation, "missing_input");
	}

	let body: Record<string, unknown>;
	try {
		body = JSON.parse(input);
	} catch {
		throw new CliError("--input must be valid JSON", ExitCode.Validation, "invalid_json");
	}

	const { envelope, exitCode } = await gatewayRequest("/proliferate/sessions", {
		method: "POST",
		body: JSON.stringify(body),
	});
	printEnvelope(envelope);
	return exitCode;
}

async function childList(): Promise<number> {
	const { envelope, exitCode } = await gatewayRequest("/proliferate/:sessionId/children");
	printEnvelope(envelope);
	return exitCode;
}

async function childInspect(flags: Record<string, string>): Promise<number> {
	const childId = flags.child;
	if (!childId) {
		throw new CliError(
			"--child is required for child inspect",
			ExitCode.Validation,
			"missing_child",
		);
	}

	const { envelope, exitCode } = await gatewayRequest(
		`/proliferate/sessions/${encodeURIComponent(childId)}/status`,
	);
	printEnvelope(envelope);
	return exitCode;
}

async function childMessage(flags: Record<string, string>): Promise<number> {
	const childId = flags.child;
	const content = flags.content;

	if (!childId) {
		throw new CliError(
			"--child is required for child message",
			ExitCode.Validation,
			"missing_child",
		);
	}
	if (!content) {
		throw new CliError(
			"--content is required for child message",
			ExitCode.Validation,
			"missing_content",
		);
	}

	const { envelope, exitCode } = await gatewayRequest(
		`/proliferate/${encodeURIComponent(childId)}/message`,
		{
			method: "POST",
			body: JSON.stringify({ type: "prompt", content }),
		},
	);
	printEnvelope(envelope);
	return exitCode;
}

async function childCancel(flags: Record<string, string>): Promise<number> {
	const childId = flags.child;
	if (!childId) {
		throw new CliError(
			"--child is required for child cancel",
			ExitCode.Validation,
			"missing_child",
		);
	}

	const { envelope, exitCode } = await gatewayRequest(
		`/proliferate/${encodeURIComponent(childId)}/cancel`,
		{ method: "POST" },
	);
	printEnvelope(envelope);
	return exitCode;
}

export async function handleManagerCommand(args: string[]): Promise<number> {
	const [group, subcommand, ...rest] = args;

	if (group !== "child") {
		throw new CliError(
			`Unknown manager group: ${group ?? "(none)"}. Available: child`,
			ExitCode.Validation,
			"unknown_command",
		);
	}

	const flags = parseFlags(rest);

	switch (subcommand) {
		case "spawn":
			return childSpawn(flags);
		case "list":
			return childList();
		case "inspect":
			return childInspect(flags);
		case "message":
			return childMessage(flags);
		case "cancel":
			return childCancel(flags);
		default:
			throw new CliError(
				`Unknown manager child command: ${subcommand ?? "(none)"}. Available: spawn, list, inspect, message, cancel`,
				ExitCode.Validation,
				"unknown_command",
			);
	}
}
