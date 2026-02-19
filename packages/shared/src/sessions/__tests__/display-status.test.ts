import { describe, expect, it } from "vitest";
import { deriveDisplayStatus, getBlockedReasonText } from "../display-status";

describe("deriveDisplayStatus", () => {
	// Active states
	it.each([
		["pending", null],
		["pending", undefined],
		["starting", null],
		["running", null],
		["running", "inactivity"], // pauseReason irrelevant when status is running
	])('returns "active" for status=%s, pauseReason=%s', (status, pauseReason) => {
		expect(deriveDisplayStatus(status, pauseReason)).toBe("active");
	});

	// Stopped → completed or failed
	it('returns "completed" for stopped with no pauseReason', () => {
		expect(deriveDisplayStatus("stopped", null)).toBe("completed");
	});

	it('returns "completed" for stopped with unrelated pauseReason', () => {
		expect(deriveDisplayStatus("stopped", "manual")).toBe("completed");
	});

	it('returns "failed" for stopped + snapshot_failed', () => {
		expect(deriveDisplayStatus("stopped", "snapshot_failed")).toBe("failed");
	});

	// Failed (top-level)
	it('returns "failed" for status=failed', () => {
		expect(deriveDisplayStatus("failed", null)).toBe("failed");
	});

	// Suspended (top-level)
	it('returns "blocked" for status=suspended', () => {
		expect(deriveDisplayStatus("suspended", null)).toBe("blocked");
	});

	// Paused states
	it('returns "idle" for paused + inactivity', () => {
		expect(deriveDisplayStatus("paused", "inactivity")).toBe("idle");
	});

	it('returns "paused" for paused + manual', () => {
		expect(deriveDisplayStatus("paused", "manual")).toBe("paused");
	});

	it('returns "paused" for paused + null (legacy)', () => {
		expect(deriveDisplayStatus("paused", null)).toBe("paused");
	});

	it('returns "paused" for paused + undefined', () => {
		expect(deriveDisplayStatus("paused", undefined)).toBe("paused");
	});

	it.each(["credit_limit", "payment_failed", "overage_cap", "suspended"])(
		'returns "blocked" for paused + %s',
		(reason) => {
			expect(deriveDisplayStatus("paused", reason)).toBe("blocked");
		},
	);

	it('returns "recovering" for paused + orphaned', () => {
		expect(deriveDisplayStatus("paused", "orphaned")).toBe("recovering");
	});

	it('returns "paused" for paused + unknown reason (future-proof)', () => {
		expect(deriveDisplayStatus("paused", "some_future_reason")).toBe("paused");
	});

	// Edge cases
	it('returns "failed" for null status', () => {
		expect(deriveDisplayStatus(null, null)).toBe("failed");
	});

	it('returns "failed" for undefined status', () => {
		expect(deriveDisplayStatus(undefined, undefined)).toBe("failed");
	});

	it('returns "failed" for unknown status string', () => {
		expect(deriveDisplayStatus("unknown_status", null)).toBe("failed");
	});

	it('returns "failed" for empty string status', () => {
		expect(deriveDisplayStatus("", null)).toBe("failed");
	});
});

describe("getBlockedReasonText", () => {
	it('returns "Out of credits" for credit_limit', () => {
		expect(getBlockedReasonText("credit_limit", "paused")).toBe("Out of credits");
	});

	it('returns "Payment failed" for payment_failed', () => {
		expect(getBlockedReasonText("payment_failed", "paused")).toBe("Payment failed");
	});

	it('returns "Usage cap reached" for overage_cap', () => {
		expect(getBlockedReasonText("overage_cap", "paused")).toBe("Usage cap reached");
	});

	it('returns "Account suspended" for pauseReason=suspended', () => {
		expect(getBlockedReasonText("suspended", "paused")).toBe("Account suspended");
	});

	it('returns "Account suspended" for status=suspended', () => {
		expect(getBlockedReasonText(null, "suspended")).toBe("Account suspended");
	});

	it("returns null for non-blocked reasons", () => {
		expect(getBlockedReasonText("manual", "paused")).toBeNull();
		expect(getBlockedReasonText("inactivity", "paused")).toBeNull();
		expect(getBlockedReasonText(null, "paused")).toBeNull();
		expect(getBlockedReasonText(null, "running")).toBeNull();
	});
});
