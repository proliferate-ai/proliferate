import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@proliferate/environment/server";

export type OAuthStateVerificationError =
	| "invalid_encoding"
	| "invalid_payload"
	| "missing_signature"
	| "invalid_signature";

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => canonicalize(item));
	}

	if (value && typeof value === "object") {
		const result: Record<string, unknown> = {};
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
			a.localeCompare(b),
		);

		for (const [key, item] of entries) {
			result[key] = canonicalize(item);
		}

		return result;
	}

	return value;
}

function stringifyCanonical(value: Record<string, unknown>): string {
	return JSON.stringify(canonicalize(value));
}

function signPayload(payload: Record<string, unknown>): string {
	const hmac = createHmac("sha256", env.BETTER_AUTH_SECRET);
	hmac.update(stringifyCanonical(payload));
	return hmac.digest("hex");
}

function safeHexBuffer(value: string): Buffer | null {
	if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
		return null;
	}
	return Buffer.from(value, "hex");
}

function signaturesMatch(provided: string, expected: string): boolean {
	const providedBuffer = safeHexBuffer(provided);
	const expectedBuffer = safeHexBuffer(expected);

	if (!providedBuffer || !expectedBuffer) {
		return false;
	}

	if (providedBuffer.length !== expectedBuffer.length) {
		return false;
	}

	return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function createSignedOAuthState(payload: Record<string, unknown>): string {
	const signature = signPayload(payload);
	const signedPayload = {
		...payload,
		_sig: signature,
	};
	return Buffer.from(JSON.stringify(signedPayload)).toString("base64url");
}

export function verifySignedOAuthState<T extends Record<string, unknown>>(
	state: string,
): { ok: true; payload: T } | { ok: false; error: OAuthStateVerificationError } {
	let parsedState: unknown;
	try {
		parsedState = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
	} catch {
		return { ok: false, error: "invalid_encoding" };
	}

	if (!parsedState || typeof parsedState !== "object" || Array.isArray(parsedState)) {
		return { ok: false, error: "invalid_payload" };
	}

	const signedPayload = parsedState as Record<string, unknown>;
	const signature = signedPayload._sig;
	if (typeof signature !== "string" || signature.length === 0) {
		return { ok: false, error: "missing_signature" };
	}

	const { _sig: _ignored, ...payload } = signedPayload;
	const expectedSignature = signPayload(payload);
	if (!signaturesMatch(signature, expectedSignature)) {
		return { ok: false, error: "invalid_signature" };
	}

	return { ok: true, payload: payload as T };
}
