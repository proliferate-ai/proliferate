import { describe, expect, it } from "vitest";
import { sanitizePromptSnippet } from "../prompt-snippet";

describe("sanitizePromptSnippet", () => {
	// Null/empty inputs
	it("returns null for null input", () => {
		expect(sanitizePromptSnippet(null)).toBeNull();
	});

	it("returns null for undefined input", () => {
		expect(sanitizePromptSnippet(undefined)).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(sanitizePromptSnippet("")).toBeNull();
	});

	it("returns null for very short input (under 10 chars)", () => {
		expect(sanitizePromptSnippet("Hi")).toBeNull();
		expect(sanitizePromptSnippet("Fix bug")).toBeNull();
	});

	// Normal text
	it("returns cleaned text for a normal prompt", () => {
		const result = sanitizePromptSnippet(
			"Fix the authentication regression in the login flow that was introduced in commit abc123",
		);
		expect(result).toBe(
			"Fix the authentication regression in the login flow that was introduced in commit abc123",
		);
	});

	// Truncation at word boundary
	it("truncates long text at word boundary with ellipsis", () => {
		const longPrompt =
			"Please refactor the entire authentication module to use JWT tokens instead of session cookies. This includes updating the middleware, the login endpoint, the registration endpoint, and all protected routes.";
		const result = sanitizePromptSnippet(longPrompt);
		expect(result).not.toBeNull();
		expect(result!.length).toBeLessThanOrEqual(151); // 150 + ellipsis
		expect(result!.endsWith("\u2026")).toBe(true);
		// Should end at a word boundary
		expect(result!.at(-2)).not.toBe(" ");
	});

	// HTML/XML stripping
	it("strips HTML tags", () => {
		const result = sanitizePromptSnippet(
			"<context><file path='auth.ts'>content</file></context>Fix the login bug in the authentication system please",
		);
		expect(result).not.toContain("<");
		expect(result).not.toContain(">");
		expect(result).toContain("Fix the login bug");
	});

	// Markdown stripping
	it("strips markdown formatting", () => {
		const result = sanitizePromptSnippet(
			"## Task\n\nPlease **fix** the login bug in the _authentication_ system\n\n```js\nconsole.log('test');\n```",
		);
		expect(result).not.toContain("##");
		expect(result).not.toContain("**");
		expect(result).not.toContain("```");
		expect(result).toContain("fix");
		expect(result).toContain("login");
	});

	// JSON extraction
	it("extracts content from JSON with known key", () => {
		const jsonPrompt = JSON.stringify({
			message: "Fix the broken deploy pipeline for the staging environment",
			context: { repo: "my-app" },
		});
		const result = sanitizePromptSnippet(jsonPrompt);
		expect(result).toBe("Fix the broken deploy pipeline for the staging environment");
	});

	it("extracts content from JSON with body key", () => {
		const jsonPrompt = JSON.stringify({
			body: "Update the README with new installation instructions for developers",
		});
		const result = sanitizePromptSnippet(jsonPrompt);
		expect(result).toBe("Update the README with new installation instructions for developers");
	});

	it("handles JSON that lacks useful keys by stripping noise", () => {
		const jsonPrompt = '{"foo": "bar", "baz": 123}';
		// Should strip leading JSON noise and try to produce something
		const result = sanitizePromptSnippet(jsonPrompt);
		// Could be null or a cleaned-up version — either is acceptable
		// The key thing is no crash
		expect(result === null || typeof result === "string").toBe(true);
	});

	// Whitespace normalization
	it("collapses multiple newlines and spaces", () => {
		const result = sanitizePromptSnippet(
			"Fix the login bug\n\n\n   in the    authentication\t\tsystem for the application",
		);
		expect(result).not.toContain("\n");
		expect(result).not.toContain("\t");
		expect(result).not.toContain("  ");
	});

	// Hard fallback for no-space content
	it("uses hard fallback for minified code (no spaces)", () => {
		const minified = "a".repeat(200);
		const result = sanitizePromptSnippet(minified);
		expect(result).not.toBeNull();
		expect(result!.length).toBeLessThanOrEqual(151);
		expect(result!.endsWith("\u2026")).toBe(true);
	});

	// Pre-slice protection
	it("handles very large input without hanging", () => {
		const huge = "Fix the bug. ".repeat(10000);
		const start = Date.now();
		const result = sanitizePromptSnippet(huge);
		const elapsed = Date.now() - start;
		expect(result).not.toBeNull();
		expect(elapsed).toBeLessThan(100); // Should complete quickly
	});

	// Mixed content
	it("handles mixed XML + markdown + text", () => {
		const mixed =
			"<system>You are an assistant</system>\n\n# Task\n\nFix the **broken** login flow in the authentication module";
		const result = sanitizePromptSnippet(mixed);
		expect(result).toContain("Fix the");
		expect(result).toContain("broken");
		expect(result).not.toContain("<system>");
		expect(result).not.toContain("#");
		expect(result).not.toContain("**");
	});
});
