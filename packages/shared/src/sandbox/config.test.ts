import { describe, expect, it } from "vitest";
import {
	parsePrebuildServiceCommands,
	parseServiceCommands,
	resolveServiceCommands,
	shellEscape,
} from "./config";

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

describe("parsePrebuildServiceCommands", () => {
	it("returns empty array for non-array input", () => {
		expect(parsePrebuildServiceCommands(null)).toEqual([]);
		expect(parsePrebuildServiceCommands(undefined)).toEqual([]);
		expect(parsePrebuildServiceCommands("string")).toEqual([]);
		expect(parsePrebuildServiceCommands({})).toEqual([]);
	});

	it("returns empty array for empty array", () => {
		expect(parsePrebuildServiceCommands([])).toEqual([]);
	});

	it("parses valid commands with workspacePath", () => {
		const input = [
			{ name: "dev", command: "pnpm dev", workspacePath: "frontend" },
			{ name: "api", command: "pnpm start", workspacePath: "backend", cwd: "src" },
		];
		expect(parsePrebuildServiceCommands(input)).toEqual(input);
	});

	it("parses commands without workspacePath", () => {
		const input = [{ name: "dev", command: "pnpm dev" }];
		expect(parsePrebuildServiceCommands(input)).toEqual(input);
	});

	it("rejects more than 10 commands", () => {
		const input = Array.from({ length: 11 }, (_, i) => ({
			name: `cmd-${i}`,
			command: `echo ${i}`,
		}));
		expect(parsePrebuildServiceCommands(input)).toEqual([]);
	});
});

describe("resolveServiceCommands", () => {
	it("uses prebuild commands when present", () => {
		const prebuildCmds = [{ name: "dev", command: "pnpm dev", workspacePath: "frontend" }];
		const repoSpecs = [
			{
				workspacePath: "frontend",
				serviceCommands: [{ name: "old", command: "npm start" }],
			},
		];
		expect(resolveServiceCommands(prebuildCmds, repoSpecs)).toEqual(prebuildCmds);
	});

	it("falls back to repo commands when prebuild has none", () => {
		const repoSpecs = [
			{
				workspacePath: "frontend",
				serviceCommands: [
					{ name: "dev", command: "pnpm dev" },
					{ name: "css", command: "pnpm css:watch", cwd: "styles" },
				],
			},
		];
		expect(resolveServiceCommands(null, repoSpecs)).toEqual([
			{ name: "dev", command: "pnpm dev", cwd: undefined, workspacePath: "frontend" },
			{ name: "css", command: "pnpm css:watch", cwd: "styles", workspacePath: "frontend" },
		]);
	});

	it("falls back to repo commands when prebuild is empty array", () => {
		const repoSpecs = [
			{
				workspacePath: ".",
				serviceCommands: [{ name: "dev", command: "pnpm dev" }],
			},
		];
		expect(resolveServiceCommands([], repoSpecs)).toEqual([
			{ name: "dev", command: "pnpm dev", cwd: undefined, workspacePath: "." },
		]);
	});

	it("merges commands from multiple repos", () => {
		const repoSpecs = [
			{
				workspacePath: "frontend",
				serviceCommands: [{ name: "fe-dev", command: "pnpm dev" }],
			},
			{
				workspacePath: "backend",
				serviceCommands: [{ name: "be-dev", command: "pnpm start" }],
			},
		];
		expect(resolveServiceCommands(null, repoSpecs)).toEqual([
			{ name: "fe-dev", command: "pnpm dev", cwd: undefined, workspacePath: "frontend" },
			{ name: "be-dev", command: "pnpm start", cwd: undefined, workspacePath: "backend" },
		]);
	});

	it("returns empty array when no commands anywhere", () => {
		expect(resolveServiceCommands(null, [])).toEqual([]);
		expect(resolveServiceCommands(null, [{ workspacePath: "." }])).toEqual([]);
	});

	it("returns empty array when prebuild commands are invalid", () => {
		const repoSpecs = [
			{
				workspacePath: ".",
				serviceCommands: [{ name: "dev", command: "pnpm dev" }],
			},
		];
		// Invalid prebuild commands fall through to repo fallback
		expect(resolveServiceCommands("not-an-array", repoSpecs)).toEqual([
			{ name: "dev", command: "pnpm dev", cwd: undefined, workspacePath: "." },
		]);
	});
});
