import { describe, expect, it } from "vitest";
import { parseServiceCommands, shellEscape } from "./config";

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
		expect(parseServiceCommands(42)).toEqual([]);
		expect(parseServiceCommands({})).toEqual([]);
	});

	it("returns empty array for empty array", () => {
		expect(parseServiceCommands([])).toEqual([]);
	});

	it("parses valid commands", () => {
		const input = [
			{ name: "dev", command: "pnpm dev" },
			{ name: "css", command: "pnpm tailwind --watch", cwd: "frontend" },
		];
		expect(parseServiceCommands(input)).toEqual(input);
	});

	it("rejects commands with missing name", () => {
		const input = [{ command: "pnpm dev" }];
		expect(parseServiceCommands(input)).toEqual([]);
	});

	it("rejects commands with missing command", () => {
		const input = [{ name: "dev" }];
		expect(parseServiceCommands(input)).toEqual([]);
	});

	it("rejects commands with empty name", () => {
		const input = [{ name: "", command: "pnpm dev" }];
		expect(parseServiceCommands(input)).toEqual([]);
	});

	it("rejects commands with empty command", () => {
		const input = [{ name: "dev", command: "" }];
		expect(parseServiceCommands(input)).toEqual([]);
	});

	it("rejects more than 10 commands", () => {
		const input = Array.from({ length: 11 }, (_, i) => ({
			name: `cmd-${i}`,
			command: `echo ${i}`,
		}));
		expect(parseServiceCommands(input)).toEqual([]);
	});

	it("accepts exactly 10 commands", () => {
		const input = Array.from({ length: 10 }, (_, i) => ({
			name: `cmd-${i}`,
			command: `echo ${i}`,
		}));
		expect(parseServiceCommands(input)).toEqual(input);
	});

	it("rejects commands with name exceeding 100 chars", () => {
		const input = [{ name: "x".repeat(101), command: "echo test" }];
		expect(parseServiceCommands(input)).toEqual([]);
	});

	it("rejects commands with command exceeding 1000 chars", () => {
		const input = [{ name: "dev", command: "x".repeat(1001) }];
		expect(parseServiceCommands(input)).toEqual([]);
	});
});
