import { describe, expect, it } from "vitest";
import { CronValidationError, assertValidCronExpression, validateCronExpression } from "./service";

describe("validateCronExpression", () => {
	it("accepts valid 5-field expressions", () => {
		expect(validateCronExpression("* * * * *")).toBe(true);
		expect(validateCronExpression("0 9 * * 1-5")).toBe(true);
		expect(validateCronExpression("*/15 0-23/2 * * *")).toBe(true);
		expect(validateCronExpression("0 0 1 JAN *")).toBe(true);
		expect(validateCronExpression("0 0 * * MON-FRI")).toBe(true);
	});

	it("accepts valid 6-field expressions", () => {
		expect(validateCronExpression("0 */5 * * * *")).toBe(true);
		expect(validateCronExpression("30 0 9 * * MON")).toBe(true);
	});

	it("rejects malformed expressions", () => {
		expect(validateCronExpression("invalid cron string test")).toBe(false);
		expect(validateCronExpression("* * * *")).toBe(false);
		expect(validateCronExpression("* * * * * * *")).toBe(false);
		expect(validateCronExpression("")).toBe(false);
	});

	it("rejects out-of-range field values", () => {
		expect(validateCronExpression("60 * * * *")).toBe(false);
		expect(validateCronExpression("* 24 * * *")).toBe(false);
		expect(validateCronExpression("* * 0 * *")).toBe(false);
		expect(validateCronExpression("* * * 13 *")).toBe(false);
		expect(validateCronExpression("* * * * 8")).toBe(false);
	});

	it("rejects invalid step expressions", () => {
		expect(validateCronExpression("*/0 * * * *")).toBe(false);
		expect(validateCronExpression("*/-1 * * * *")).toBe(false);
		expect(validateCronExpression("*/abc * * * *")).toBe(false);
	});
});

describe("assertValidCronExpression", () => {
	it("throws CronValidationError for invalid cron", () => {
		expect(() => assertValidCronExpression("invalid cron string test")).toThrow(
			CronValidationError,
		);
	});

	it("does not throw for valid cron", () => {
		expect(() => assertValidCronExpression("0 9 * * 1-5")).not.toThrow();
	});
});
