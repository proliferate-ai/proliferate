/**
 * Session Namespace Commands
 *
 * proliferate session info         — current session metadata
 * proliferate session status       — runtime/operator status
 * proliferate session capabilities — list allowed tools from gateway
 */

import { printEnvelope } from "../lib/envelope.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";
import { gatewayRequest } from "../lib/gateway-client.ts";

export async function sessionInfo(): Promise<number> {
	const { envelope, exitCode } = await gatewayRequest("/proliferate/:sessionId");
	printEnvelope(envelope);
	return exitCode;
}

export async function sessionStatus(): Promise<number> {
	const { envelope, exitCode } = await gatewayRequest("/proliferate/sessions/:sessionId/status");
	printEnvelope(envelope);
	return exitCode;
}

export async function sessionCapabilities(): Promise<number> {
	const { envelope, exitCode } = await gatewayRequest("/proliferate/:sessionId/actions/available");
	printEnvelope(envelope);
	return exitCode;
}

export async function handleSessionCommand(args: string[]): Promise<number> {
	const subcommand = args[0];

	switch (subcommand) {
		case "info":
			return sessionInfo();
		case "status":
			return sessionStatus();
		case "capabilities":
			return sessionCapabilities();
		default:
			throw new CliError(
				`Unknown session command: ${subcommand ?? "(none)"}. Available: info, status, capabilities`,
				ExitCode.Validation,
				"unknown_command",
			);
	}
}
