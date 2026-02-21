import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@proliferate/environment/server", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-oauth-state-secret",
	},
}));

import { createSignedOAuthState, verifySignedOAuthState } from "@/lib/oauth-state";

describe("oauth-state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("verifies a signed state payload", () => {
		const state = createSignedOAuthState({
			orgId: "org-1",
			userId: "user-1",
			nonce: "nonce-1",
			timestamp: 123,
			returnUrl: "/dashboard",
		});

		const verified = verifySignedOAuthState<Record<string, unknown>>(state);
		expect(verified.ok).toBe(true);
		if (!verified.ok) {
			return;
		}

		expect(verified.payload.orgId).toBe("org-1");
		expect(verified.payload.userId).toBe("user-1");
		expect(verified.payload.returnUrl).toBe("/dashboard");
	});

	it("rejects tampered payloads", () => {
		const state = createSignedOAuthState({
			orgId: "org-1",
			userId: "user-1",
			nonce: "nonce-1",
			timestamp: 123,
		});
		const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as Record<
			string,
			unknown
		>;
		decoded.orgId = "org-2";
		const tamperedState = Buffer.from(JSON.stringify(decoded)).toString("base64url");

		const verified = verifySignedOAuthState<Record<string, unknown>>(tamperedState);
		expect(verified).toEqual({ ok: false, error: "invalid_signature" });
	});

	it("rejects payloads without signatures", () => {
		const unsignedState = Buffer.from(
			JSON.stringify({
				orgId: "org-1",
				userId: "user-1",
			}),
		).toString("base64url");

		const verified = verifySignedOAuthState<Record<string, unknown>>(unsignedState);
		expect(verified).toEqual({ ok: false, error: "missing_signature" });
	});

	it("uses stable key ordering for signatures across payload insertion order", () => {
		const payloadA = {
			"key-2": "value-2",
			key_1: "value-1",
			keyA: "value-a",
			keyB: "value-b",
		};
		const payloadB = {
			keyB: "value-b",
			keyA: "value-a",
			key_1: "value-1",
			"key-2": "value-2",
		};

		const stateA = createSignedOAuthState(payloadA);
		const stateB = createSignedOAuthState(payloadB);
		const decodedA = JSON.parse(Buffer.from(stateA, "base64url").toString("utf8")) as Record<
			string,
			unknown
		>;
		const decodedB = JSON.parse(Buffer.from(stateB, "base64url").toString("utf8")) as Record<
			string,
			unknown
		>;

		expect(decodedA._sig).toBe(decodedB._sig);
	});
});
