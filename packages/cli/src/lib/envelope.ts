/**
 * CLI JSON Envelope
 *
 * All CLI command responses use this standardized envelope format.
 * Consumed by manager tools and coding harness operations.
 */

import { randomUUID } from "node:crypto";

export interface EnvelopeMeta {
	requestId: string;
	sessionId: string | null;
	capabilitiesVersion: number | null;
	cursor: string | null;
}

export interface CliEnvelope<T = unknown> {
	ok: boolean;
	data: T | null;
	error: string | null;
	meta: EnvelopeMeta;
}

export function successEnvelope<T>(data: T, meta?: Partial<EnvelopeMeta>): CliEnvelope<T> {
	return {
		ok: true,
		data,
		error: null,
		meta: {
			requestId: meta?.requestId ?? randomUUID(),
			sessionId: meta?.sessionId ?? null,
			capabilitiesVersion: meta?.capabilitiesVersion ?? null,
			cursor: meta?.cursor ?? null,
		},
	};
}

export function errorEnvelope(error: string, meta?: Partial<EnvelopeMeta>): CliEnvelope<null> {
	return {
		ok: false,
		data: null,
		error,
		meta: {
			requestId: meta?.requestId ?? randomUUID(),
			sessionId: meta?.sessionId ?? null,
			capabilitiesVersion: meta?.capabilitiesVersion ?? null,
			cursor: meta?.cursor ?? null,
		},
	};
}

/**
 * Print an envelope to stdout as JSON.
 * All command output goes through this for machine-readable parsing.
 */
export function printEnvelope(envelope: CliEnvelope): void {
	process.stdout.write(`${JSON.stringify(envelope)}\n`);
}
