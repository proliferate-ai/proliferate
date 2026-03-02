/**
 * Baseline Namespace Commands
 *
 * proliferate baseline info    — current baseline metadata
 * proliferate baseline targets — list targets
 */

import { printEnvelope } from "../lib/envelope.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";
import { gatewayRequest } from "../lib/gateway-client.ts";

async function baselineInfo(): Promise<number> {
	const { envelope, exitCode } = await gatewayRequest("/proliferate/:sessionId/baseline");
	printEnvelope(envelope);
	return exitCode;
}

async function baselineTargets(): Promise<number> {
	const { envelope, exitCode } = await gatewayRequest("/proliferate/:sessionId/baseline/targets");
	printEnvelope(envelope);
	return exitCode;
}

export async function handleBaselineCommand(args: string[]): Promise<number> {
	const subcommand = args[0];

	switch (subcommand) {
		case "info":
			return baselineInfo();
		case "targets":
			return baselineTargets();
		default:
			throw new CliError(
				`Unknown baseline command: ${subcommand ?? "(none)"}. Available: info, targets`,
				ExitCode.Validation,
				"unknown_command",
			);
	}
}
