/**
 * Golden Contract Tests: Envelope Shape
 *
 * Every CLI command response must match the canonical envelope structure.
 */

import { describe, expect, it } from "vitest";
import { type CliEnvelope, errorEnvelope, successEnvelope } from "../envelope.ts";

/** Validate that an object is a well-formed CLI envelope. */
function assertEnvelopeShape(envelope: CliEnvelope): void {
	// Top-level keys
	expect(envelope).toHaveProperty("ok");
	expect(envelope).toHaveProperty("data");
	expect(envelope).toHaveProperty("error");
	expect(envelope).toHaveProperty("meta");

	// Types
	expect(typeof envelope.ok).toBe("boolean");
	expect(typeof envelope.error === "string" || envelope.error === null).toBe(true);

	// Meta shape
	const { meta } = envelope;
	expect(meta).toHaveProperty("requestId");
	expect(meta).toHaveProperty("sessionId");
	expect(meta).toHaveProperty("capabilitiesVersion");
	expect(meta).toHaveProperty("cursor");
	expect(typeof meta.requestId).toBe("string");
	expect(meta.requestId.length).toBeGreaterThan(0);
}

describe("successEnvelope", () => {
	it("returns correct envelope shape with data", () => {
		const envelope = successEnvelope({ foo: "bar" });

		assertEnvelopeShape(envelope);
		expect(envelope.ok).toBe(true);
		expect(envelope.data).toEqual({ foo: "bar" });
		expect(envelope.error).toBeNull();
	});

	it("includes meta overrides", () => {
		const envelope = successEnvelope("data", {
			sessionId: "sess_123",
			capabilitiesVersion: 5,
			cursor: "next_page",
		});

		assertEnvelopeShape(envelope);
		expect(envelope.meta.sessionId).toBe("sess_123");
		expect(envelope.meta.capabilitiesVersion).toBe(5);
		expect(envelope.meta.cursor).toBe("next_page");
	});

	it("defaults meta fields to null", () => {
		const envelope = successEnvelope(null);

		expect(envelope.meta.sessionId).toBeNull();
		expect(envelope.meta.capabilitiesVersion).toBeNull();
		expect(envelope.meta.cursor).toBeNull();
	});

	it("generates unique requestIds", () => {
		const a = successEnvelope(null);
		const b = successEnvelope(null);
		expect(a.meta.requestId).not.toBe(b.meta.requestId);
	});
});

describe("errorEnvelope", () => {
	it("returns correct envelope shape with error", () => {
		const envelope = errorEnvelope("something went wrong");

		assertEnvelopeShape(envelope);
		expect(envelope.ok).toBe(false);
		expect(envelope.data).toBeNull();
		expect(envelope.error).toBe("something went wrong");
	});

	it("includes meta overrides", () => {
		const envelope = errorEnvelope("fail", { sessionId: "sess_456" });

		expect(envelope.meta.sessionId).toBe("sess_456");
	});
});

describe("envelope serialization", () => {
	it("success envelope is valid JSON", () => {
		const envelope = successEnvelope({ items: [1, 2, 3] });
		const json = JSON.stringify(envelope);
		const parsed = JSON.parse(json);

		expect(parsed.ok).toBe(true);
		expect(parsed.data.items).toEqual([1, 2, 3]);
		expect(parsed.error).toBeNull();
		expect(typeof parsed.meta.requestId).toBe("string");
	});

	it("error envelope is valid JSON", () => {
		const envelope = errorEnvelope("bad request");
		const json = JSON.stringify(envelope);
		const parsed = JSON.parse(json);

		expect(parsed.ok).toBe(false);
		expect(parsed.data).toBeNull();
		expect(parsed.error).toBe("bad request");
	});
});

describe("envelope for each namespace", () => {
	it("session namespace produces valid envelope", () => {
		const envelope = successEnvelope({ sessionId: "s1", status: "running" }, { sessionId: "s1" });
		assertEnvelopeShape(envelope);
		expect(envelope.ok).toBe(true);
	});

	it("manager namespace produces valid envelope", () => {
		const envelope = successEnvelope(
			{ children: [{ sessionId: "child1", status: "running" }] },
			{ sessionId: "parent" },
		);
		assertEnvelopeShape(envelope);
		expect(envelope.ok).toBe(true);
	});

	it("source namespace produces valid envelope with cursor", () => {
		const envelope = successEnvelope(
			{ items: [], hasMore: true },
			{ sessionId: "s1", cursor: "page2" },
		);
		assertEnvelopeShape(envelope);
		expect(envelope.meta.cursor).toBe("page2");
	});

	it("action namespace produces valid envelope for pending_approval", () => {
		const envelope = successEnvelope(
			{ invocationId: "inv1", status: "pending_approval" },
			{ sessionId: "s1" },
		);
		assertEnvelopeShape(envelope);
		expect(envelope.data?.status).toBe("pending_approval");
	});

	it("baseline namespace produces valid envelope", () => {
		const envelope = successEnvelope({ targets: ["repo1", "repo2"] }, { sessionId: "s1" });
		assertEnvelopeShape(envelope);
		expect(envelope.ok).toBe(true);
	});

	it("error response produces valid envelope with error code", () => {
		const envelope = errorEnvelope("Policy denied: action not allowed");
		assertEnvelopeShape(envelope);
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toContain("Policy denied");
	});
});
