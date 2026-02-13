import type { ConnectorRiskPolicy } from "@proliferate/shared";
import { describe, expect, it } from "vitest";
import { type McpToolAnnotations, deriveRiskLevel } from "./risk";

describe("deriveRiskLevel", () => {
	it("returns policy override when one exists for the tool", () => {
		const policy: ConnectorRiskPolicy = {
			overrides: { dangerous_tool: "danger" },
		};
		expect(deriveRiskLevel("dangerous_tool", undefined, policy)).toBe("danger");
	});

	it("prefers policy override over MCP annotations", () => {
		const policy: ConnectorRiskPolicy = {
			overrides: { read_tool: "write" },
		};
		const annotations: McpToolAnnotations = { readOnlyHint: true };
		expect(deriveRiskLevel("read_tool", annotations, policy)).toBe("write");
	});

	it("returns 'read' when readOnlyHint is true", () => {
		const annotations: McpToolAnnotations = { readOnlyHint: true };
		expect(deriveRiskLevel("some_tool", annotations, undefined)).toBe("read");
	});

	it("returns 'danger' when destructiveHint is true", () => {
		const annotations: McpToolAnnotations = { destructiveHint: true };
		expect(deriveRiskLevel("some_tool", annotations, undefined)).toBe("danger");
	});

	it("prefers destructiveHint over readOnlyHint when both are true (fail-safe)", () => {
		const annotations: McpToolAnnotations = {
			readOnlyHint: true,
			destructiveHint: true,
		};
		expect(deriveRiskLevel("some_tool", annotations, undefined)).toBe("danger");
	});

	it("returns policy defaultRisk when no override or annotations match", () => {
		const policy: ConnectorRiskPolicy = { defaultRisk: "read" };
		expect(deriveRiskLevel("some_tool", undefined, policy)).toBe("read");
	});

	it("returns policy defaultRisk when annotations have no hints", () => {
		const policy: ConnectorRiskPolicy = { defaultRisk: "danger" };
		const annotations: McpToolAnnotations = {};
		expect(deriveRiskLevel("some_tool", annotations, policy)).toBe("danger");
	});

	it("falls back to 'write' when nothing else matches", () => {
		expect(deriveRiskLevel("some_tool", undefined, undefined)).toBe("write");
	});

	it("falls back to 'write' with empty policy and empty annotations", () => {
		expect(deriveRiskLevel("some_tool", {}, {})).toBe("write");
	});

	it("ignores annotations when readOnlyHint is false", () => {
		const annotations: McpToolAnnotations = { readOnlyHint: false };
		expect(deriveRiskLevel("some_tool", annotations, undefined)).toBe("write");
	});

	it("ignores annotations when destructiveHint is false", () => {
		const annotations: McpToolAnnotations = { destructiveHint: false };
		expect(deriveRiskLevel("some_tool", annotations, undefined)).toBe("write");
	});
});
