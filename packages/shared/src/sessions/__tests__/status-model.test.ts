import { describe, expect, it } from "vitest";
import { SessionStatusSchema, isValidSessionSandboxTransition } from "../../contracts/sessions";

describe("canonical session status schema", () => {
	it("accepts a valid canonical status payload", () => {
		const parsed = SessionStatusSchema.parse({
			sandboxState: "running",
			agentState: "iterating",
			terminalState: null,
			reason: null,
			isTerminal: false,
			agentFinishedIterating: false,
			requiresHumanReview: false,
			updatedAt: new Date().toISOString(),
		});

		expect(parsed.sandboxState).toBe("running");
		expect(parsed.agentState).toBe("iterating");
		expect(parsed.isTerminal).toBe(false);
	});

	it("rejects invalid sandbox/agent combinations", () => {
		expect(() =>
			SessionStatusSchema.parse({
				sandboxState: "unknown",
				agentState: "iterating",
				terminalState: null,
				reason: null,
				isTerminal: false,
				agentFinishedIterating: false,
				requiresHumanReview: false,
				updatedAt: null,
			}),
		).toThrow();
	});
});

describe("canonical sandbox transitions", () => {
	it("allows provisioning to running", () => {
		expect(isValidSessionSandboxTransition("provisioning", "running")).toBe(true);
	});

	it("disallows paused to provisioning", () => {
		expect(isValidSessionSandboxTransition("paused", "provisioning")).toBe(false);
	});
});
