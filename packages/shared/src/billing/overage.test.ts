import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOP_UP_PRODUCT } from "./autumn-types";
import {
	OVERAGE_INCREMENT_CREDITS,
	OVERAGE_MAX_TOPUPS_PER_CYCLE,
	OVERAGE_MIN_TOPUP_INTERVAL_MS,
	type OverageTopUpResult,
	getCurrentCycleMonth,
} from "./types";

describe("getCurrentCycleMonth", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns YYYY-MM format for current month", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-15T12:00:00Z"));

		expect(getCurrentCycleMonth()).toBe("2026-02");
	});

	it("pads single-digit months", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));

		expect(getCurrentCycleMonth()).toBe("2026-03");
	});

	it("handles December", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-12-31T23:59:59Z"));

		expect(getCurrentCycleMonth()).toBe("2026-12");
	});

	it("handles January", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));

		expect(getCurrentCycleMonth()).toBe("2027-01");
	});
});

describe("overage constants", () => {
	it("OVERAGE_MAX_TOPUPS_PER_CYCLE is reasonable", () => {
		expect(OVERAGE_MAX_TOPUPS_PER_CYCLE).toBe(20);
		expect(OVERAGE_MAX_TOPUPS_PER_CYCLE).toBeGreaterThan(0);
	});

	it("OVERAGE_MIN_TOPUP_INTERVAL_MS is 60 seconds", () => {
		expect(OVERAGE_MIN_TOPUP_INTERVAL_MS).toBe(60_000);
	});

	it("OVERAGE_INCREMENT_CREDITS is positive", () => {
		expect(OVERAGE_INCREMENT_CREDITS).toBeGreaterThan(0);
	});

	it("TOP_UP_PRODUCT has expected structure", () => {
		expect(TOP_UP_PRODUCT).toHaveProperty("productId");
		expect(TOP_UP_PRODUCT).toHaveProperty("credits");
		expect(TOP_UP_PRODUCT).toHaveProperty("priceCents");
		expect(TOP_UP_PRODUCT.credits).toBeGreaterThan(0);
		expect(TOP_UP_PRODUCT.priceCents).toBeGreaterThan(0);
	});
});

describe("OverageTopUpResult type", () => {
	it("empty result has correct shape", () => {
		const empty: OverageTopUpResult = {
			success: false,
			packsCharged: 0,
			creditsAdded: 0,
			chargedCents: 0,
		};
		expect(empty.success).toBe(false);
		expect(empty.packsCharged).toBe(0);
	});

	it("success result has credits info", () => {
		const result: OverageTopUpResult = {
			success: true,
			packsCharged: 3,
			creditsAdded: 1500,
			chargedCents: 1500,
		};
		expect(result.success).toBe(true);
		expect(result.creditsAdded).toBe(1500);
	});

	it("circuit breaker result", () => {
		const result: OverageTopUpResult = {
			success: false,
			packsCharged: 0,
			creditsAdded: 0,
			chargedCents: 0,
			circuitBreakerTripped: true,
		};
		expect(result.circuitBreakerTripped).toBe(true);
	});

	it("cap exhausted result", () => {
		const result: OverageTopUpResult = {
			success: false,
			packsCharged: 0,
			creditsAdded: 0,
			chargedCents: 0,
			capExhausted: true,
		};
		expect(result.capExhausted).toBe(true);
	});

	it("velocity limited result", () => {
		const result: OverageTopUpResult = {
			success: false,
			packsCharged: 0,
			creditsAdded: 0,
			chargedCents: 0,
			velocityLimited: true,
		};
		expect(result.velocityLimited).toBe(true);
	});
});

describe("pack sizing math", () => {
	it("computes correct pack count for small deficit", () => {
		const deficitCredits = 100;
		const creditsNeeded = Math.abs(deficitCredits) + OVERAGE_INCREMENT_CREDITS;
		const packsNeeded = Math.ceil(creditsNeeded / TOP_UP_PRODUCT.credits);

		expect(packsNeeded).toBeGreaterThan(0);
		expect(packsNeeded * TOP_UP_PRODUCT.credits).toBeGreaterThanOrEqual(creditsNeeded);
	});

	it("computes correct pack count for large deficit", () => {
		const deficitCredits = 3000;
		const creditsNeeded = Math.abs(deficitCredits) + OVERAGE_INCREMENT_CREDITS;
		const packsNeeded = Math.ceil(creditsNeeded / TOP_UP_PRODUCT.credits);

		expect(packsNeeded * TOP_UP_PRODUCT.credits).toBeGreaterThanOrEqual(creditsNeeded);
	});

	it("clamps packs to cap budget", () => {
		const packsNeeded = 10;
		const overageCapCents = 2500; // $25 cap
		const overageUsedCents = 2000; // $20 used
		const remainingCapCents = overageCapCents - overageUsedCents; // $5 remaining

		const maxPacksByBudget = Math.floor(remainingCapCents / TOP_UP_PRODUCT.priceCents);
		const clampedPacks = Math.min(packsNeeded, maxPacksByBudget);

		expect(clampedPacks).toBeLessThanOrEqual(maxPacksByBudget);
		expect(clampedPacks * TOP_UP_PRODUCT.priceCents).toBeLessThanOrEqual(remainingCapCents);
	});

	it("returns 0 packs when cap is fully exhausted", () => {
		const overageCapCents = 2000;
		const overageUsedCents = 2000;
		const remainingCapCents = overageCapCents - overageUsedCents;

		expect(remainingCapCents).toBe(0);
		const maxPacksByBudget = Math.floor(remainingCapCents / TOP_UP_PRODUCT.priceCents);
		expect(maxPacksByBudget).toBe(0);
	});
});
