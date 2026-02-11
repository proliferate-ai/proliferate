import { describe, expect, it } from "vitest";
import { isValidTargetPath, parseEnvFile } from "./env-parser";

describe("parseEnvFile", () => {
	it("parses basic KEY=VALUE pairs", () => {
		const result = parseEnvFile("API_KEY=abc123\nDB_URL=postgres://localhost");
		expect(result).toEqual([
			{ key: "API_KEY", value: "abc123" },
			{ key: "DB_URL", value: "postgres://localhost" },
		]);
	});

	it("handles double-quoted values", () => {
		const result = parseEnvFile('SECRET="has spaces and =signs"');
		expect(result).toEqual([{ key: "SECRET", value: "has spaces and =signs" }]);
	});

	it("handles single-quoted values", () => {
		const result = parseEnvFile("SECRET='single quoted'");
		expect(result).toEqual([{ key: "SECRET", value: "single quoted" }]);
	});

	it("skips comments and blank lines", () => {
		const text = `
# This is a comment
API_KEY=value

# Another comment

DB_URL=postgres
`;
		const result = parseEnvFile(text);
		expect(result).toEqual([
			{ key: "API_KEY", value: "value" },
			{ key: "DB_URL", value: "postgres" },
		]);
	});

	it("handles export prefix", () => {
		const result = parseEnvFile("export API_KEY=abc\nexport DB_URL=pg");
		expect(result).toEqual([
			{ key: "API_KEY", value: "abc" },
			{ key: "DB_URL", value: "pg" },
		]);
	});

	it("skips lines without =", () => {
		const result = parseEnvFile("INVALID_LINE\nVALID=yes");
		expect(result).toEqual([{ key: "VALID", value: "yes" }]);
	});

	it("handles values with = signs", () => {
		const result = parseEnvFile("BASE64=abc==def=");
		expect(result).toEqual([{ key: "BASE64", value: "abc==def=" }]);
	});

	it("handles empty values", () => {
		const result = parseEnvFile("EMPTY=\nALSO_EMPTY=''");
		expect(result).toEqual([
			{ key: "EMPTY", value: "" },
			{ key: "ALSO_EMPTY", value: "" },
		]);
	});

	it("trims whitespace around keys and values", () => {
		const result = parseEnvFile("  KEY  =  value  ");
		expect(result).toEqual([{ key: "KEY", value: "value" }]);
	});

	it("returns empty array for empty input", () => {
		expect(parseEnvFile("")).toEqual([]);
		expect(parseEnvFile("\n\n\n")).toEqual([]);
	});

	it("handles Windows-style line endings", () => {
		const result = parseEnvFile("A=1\r\nB=2\r\n");
		expect(result).toEqual([
			{ key: "A", value: "1" },
			{ key: "B", value: "2" },
		]);
	});

	it("strips inline comments from unquoted values", () => {
		const result = parseEnvFile("PORT=3000 # local dev\nHOST=localhost # default");
		expect(result).toEqual([
			{ key: "PORT", value: "3000" },
			{ key: "HOST", value: "localhost" },
		]);
	});

	it("preserves # inside quoted values", () => {
		const result = parseEnvFile('COLOR="#ff0000"\nTAG=\'v1#beta\'');
		expect(result).toEqual([
			{ key: "COLOR", value: "#ff0000" },
			{ key: "TAG", value: "v1#beta" },
		]);
	});

	it("handles unquoted values with # but no space before it", () => {
		const result = parseEnvFile("CHANNEL=my#channel");
		expect(result).toEqual([{ key: "CHANNEL", value: "my#channel" }]);
	});
});

describe("isValidTargetPath", () => {
	it("accepts typical env file paths", () => {
		expect(isValidTargetPath(".env")).toBe(true);
		expect(isValidTargetPath(".env.local")).toBe(true);
		expect(isValidTargetPath("apps/web/.env")).toBe(true);
		expect(isValidTargetPath("config/.env.production")).toBe(true);
	});

	it("rejects absolute paths", () => {
		expect(isValidTargetPath("/etc/passwd")).toBe(false);
		expect(isValidTargetPath("/home/user/.env")).toBe(false);
	});

	it("rejects path traversal", () => {
		expect(isValidTargetPath("../etc/passwd")).toBe(false);
		expect(isValidTargetPath("foo/../../bar")).toBe(false);
		expect(isValidTargetPath("..")).toBe(false);
	});

	it("rejects null bytes", () => {
		expect(isValidTargetPath(".env\0.local")).toBe(false);
	});

	it("rejects empty string", () => {
		expect(isValidTargetPath("")).toBe(false);
	});

	it("rejects Windows drive paths", () => {
		expect(isValidTargetPath("C:\\Users\\file")).toBe(false);
	});
});
