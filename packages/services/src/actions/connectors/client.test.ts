import { describe, expect, it } from "vitest";
import { extractToolCallContent } from "./client";

describe("extractToolCallContent", () => {
	it("prefers structuredContent when present", () => {
		const result = extractToolCallContent({
			structuredContent: { status: "ok", count: 2 },
			content: [{ type: "text", text: '{"ignored":true}' }],
		});
		expect(result).toEqual({ status: "ok", count: 2 });
	});

	it("parses JSON from text content", () => {
		const result = extractToolCallContent({
			content: [{ type: "text", text: '{"foo":"bar"}' }],
		});
		expect(result).toEqual({ foo: "bar" });
	});

	it("returns raw text when text is not JSON", () => {
		const result = extractToolCallContent({
			content: [{ type: "text", text: "plain output" }],
		});
		expect(result).toBe("plain output");
	});

	it("falls back to raw content blocks when no text blocks exist", () => {
		const result = extractToolCallContent({
			content: [{ type: "image", mimeType: "image/png", data: "abc" }],
		});
		expect(result).toEqual([{ type: "image", mimeType: "image/png", data: "abc" }]);
	});

	it("returns null when no content is available", () => {
		const result = extractToolCallContent({});
		expect(result).toBeNull();
	});
});
