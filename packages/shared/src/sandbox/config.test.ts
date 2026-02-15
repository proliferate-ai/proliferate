import { describe, expect, it } from "vitest";
import { capOutput, parseServiceCommands, shellEscape } from "./config";

describe("shellEscape", () => {
	it("wraps simple strings in single quotes", () => {
		expect(shellEscape("hello")).toBe("'hello'");
	});

	it("escapes single quotes", () => {
		expect(shellEscape("it's")).toBe("'it'\\''s'");
	});

	it("handles empty strings", () => {
		expect(shellEscape("")).toBe("''");
	});

	it("handles strings with spaces and special chars", () => {
		expect(shellEscape("hello world $PATH")).toBe("'hello world $PATH'");
	});

	it("handles multiple single quotes", () => {
		expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'");
	});
});

describe("parseServiceCommands", () => {
	it("returns empty array for non-array input", () => {
		expect(parseServiceCommands(null)).toEqual([]);
		expect(parseServiceCommands(undefined)).toEqual([]);
		expect(parseServiceCommands("string")).toEqual([]);
		expect(parseServiceCommands({})).toEqual([]);
	});

	it("returns empty array for empty array", () => {
		expect(parseServiceCommands([])).toEqual([]);
	});

	it("parses valid commands with workspacePath", () => {
		const input = [
			{ name: "dev", command: "pnpm dev", workspacePath: "frontend" },
			{ name: "api", command: "pnpm start", workspacePath: "backend", cwd: "src" },
		];
		expect(parseServiceCommands(input)).toEqual(input);
	});

	it("parses commands without workspacePath", () => {
		const input = [{ name: "dev", command: "pnpm dev" }];
		expect(parseServiceCommands(input)).toEqual(input);
	});

	it("rejects more than 10 commands", () => {
		const input = Array.from({ length: 11 }, (_, i) => ({
			name: `cmd-${i}`,
			command: `echo ${i}`,
		}));
		expect(parseServiceCommands(input)).toEqual([]);
	});
});

describe("capOutput", () => {
	it("returns short output unchanged", () => {
		expect(capOutput("hello")).toBe("hello");
	});

	it("returns empty string unchanged", () => {
		expect(capOutput("")).toBe("");
	});

	it("truncates output exceeding default limit", () => {
		const long = "x".repeat(16 * 1024 + 100);
		const result = capOutput(long);
		expect(result.length).toBeLessThan(long.length);
		expect(result).toContain("...[truncated]");
		// First 16KB should be preserved
		expect(result.startsWith("x".repeat(16 * 1024))).toBe(true);
	});

	it("respects custom maxBytes", () => {
		const result = capOutput("hello world", 5);
		expect(result).toBe("hello\n...[truncated]");
	});

	it("does not truncate at exact boundary", () => {
		const exact = "x".repeat(16 * 1024);
		expect(capOutput(exact)).toBe(exact);
	});
});
