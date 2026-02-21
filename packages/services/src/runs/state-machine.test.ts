import { describe, expect, it } from "vitest";
import {
	InvalidRunStatusTransitionError,
	VALID_TRANSITIONS,
	validateTransition,
} from "./state-machine";

describe("VALID_TRANSITIONS", () => {
	it("defines transitions for every contract status", () => {
		expect(Object.keys(VALID_TRANSITIONS).sort()).toEqual(
			[
				"canceled",
				"enriching",
				"failed",
				"needs_human",
				"queued",
				"ready",
				"running",
				"skipped",
				"succeeded",
				"timed_out",
			].sort(),
		);
	});
});

describe("validateTransition", () => {
	it("accepts legal transitions", () => {
		expect(() => validateTransition("queued", "enriching")).not.toThrow();
		expect(() => validateTransition("running", "needs_human")).not.toThrow();
		expect(() => validateTransition("timed_out", "failed")).not.toThrow();
	});

	it("rejects illegal transitions", () => {
		expect(() => validateTransition("queued", "running")).toThrow(InvalidRunStatusTransitionError);
		expect(() => validateTransition("succeeded", "failed")).toThrow(
			InvalidRunStatusTransitionError,
		);
	});

	it("rejects unknown statuses", () => {
		expect(() => validateTransition("made_up_status", "failed")).toThrow(
			InvalidRunStatusTransitionError,
		);
		expect(() => validateTransition("queued", "made_up_status")).toThrow(
			InvalidRunStatusTransitionError,
		);
	});
});
