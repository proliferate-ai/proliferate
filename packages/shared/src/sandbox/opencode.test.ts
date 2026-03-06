import { describe, expect, it } from "vitest";
import { getOpencodeConfig } from "./opencode";

describe("getOpencodeConfig", () => {
	it("does not include instructions when none are provided", () => {
		const config = getOpencodeConfig("anthropic/claude-opus-4-6");

		expect(config).not.toContain('"instructions"');
	});

	it("includes instructions when provided", () => {
		const config = getOpencodeConfig("anthropic/claude-opus-4-6", undefined, undefined, [
			".opencode/instructions.md",
			"AGENTS.md",
		]);

		expect(config).toContain('"instructions": [".opencode/instructions.md","AGENTS.md"]');
	});

	it("filters empty instruction values", () => {
		const config = getOpencodeConfig("anthropic/claude-opus-4-6", undefined, undefined, [
			"",
			"   ",
			".opencode/instructions.md",
		]);

		expect(config).toContain('"instructions": [".opencode/instructions.md"]');
	});
});
