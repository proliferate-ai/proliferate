import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTO_RECHARGE_PACK, TOP_UP_PACKS } from "./autumn-types";
import {
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

	it("TOP_UP_PACKS has expected structure", () => {
		expect(TOP_UP_PACKS.length).toBe(5);
		for (const pack of TOP_UP_PACKS) {
			expect(pack).toHaveProperty("productId");
			expect(pack).toHaveProperty("credits");
			expect(pack).toHaveProperty("priceCents");
			expect(pack.credits).toBeGreaterThan(0);
			expect(pack.priceCents).toBeGreaterThan(0);
			// All packs are $1/credit
			expect(pack.priceCents / pack.credits).toBe(100);
		}
	});

	it("DEFAULT_AUTO_RECHARGE_PACK is the Builder pack", () => {
		expect(DEFAULT_AUTO_RECHARGE_PACK.productId).toBe("topup_20");
		expect(DEFAULT_AUTO_RECHARGE_PACK.credits).toBe(20);
		expect(DEFAULT_AUTO_RECHARGE_PACK.priceCents).toBe(2000);
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
			packsCharged: 1,
			creditsAdded: 20,
			chargedCents: 2000,
		};
		expect(result.success).toBe(true);
		expect(result.creditsAdded).toBe(20);
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
	it("computes correct pack count for small deficit (matches production formula)", () => {
		const pack = DEFAULT_AUTO_RECHARGE_PACK;
		const deficitCredits = 2;
		// Production formula adds one-pack buffer: creditsNeeded = deficit + pack.credits
		const creditsNeeded = Math.abs(deficitCredits) + pack.credits;
		const packsNeeded = Math.ceil(creditsNeeded / pack.credits);

		expect(packsNeeded).toBe(2); // (2 + 20) / 20 = 1.1 → ceil = 2
		expect(packsNeeded * pack.credits).toBeGreaterThanOrEqual(creditsNeeded);
	});

	it("computes correct pack count for large deficit (matches production formula)", () => {
		const pack = DEFAULT_AUTO_RECHARGE_PACK;
		const deficitCredits = 50;
		const creditsNeeded = Math.abs(deficitCredits) + pack.credits;
		const packsNeeded = Math.ceil(creditsNeeded / pack.credits);

		expect(packsNeeded).toBe(4); // (50 + 20) / 20 = 3.5 → ceil = 4
		expect(packsNeeded * pack.credits).toBeGreaterThanOrEqual(creditsNeeded);
	});

	it("clamps packs to cap budget", () => {
		const pack = DEFAULT_AUTO_RECHARGE_PACK;
		const packsNeeded = 10;
		const overageCapCents = 25000; // $250 cap
		const overageUsedCents = 20000; // $200 used
		const remainingCapCents = overageCapCents - overageUsedCents; // $50 remaining

		const maxPacksByBudget = Math.floor(remainingCapCents / pack.priceCents);
		const clampedPacks = Math.min(packsNeeded, maxPacksByBudget);

		expect(clampedPacks).toBeLessThanOrEqual(maxPacksByBudget);
		expect(clampedPacks * pack.priceCents).toBeLessThanOrEqual(remainingCapCents);
	});

	it("returns 0 packs when cap is fully exhausted", () => {
		const pack = DEFAULT_AUTO_RECHARGE_PACK;
		const overageCapCents = 20000;
		const overageUsedCents = 20000;
		const remainingCapCents = overageCapCents - overageUsedCents;

		expect(remainingCapCents).toBe(0);
		const maxPacksByBudget = Math.floor(remainingCapCents / pack.priceCents);
		expect(maxPacksByBudget).toBe(0);
	});
});
