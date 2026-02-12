import { describe, expect, it } from "vitest";
import { ConnectorsArraySchema, parsePrebuildConnectors } from "./connectors";

describe("parsePrebuildConnectors", () => {
	const validConnector = {
		id: "550e8400-e29b-41d4-a716-446655440000",
		name: "Stripe",
		transport: "remote_http" as const,
		url: "https://mcp.stripe.com/v1/sse",
		auth: { type: "bearer" as const, secretKey: "STRIPE_SECRET_KEY" },
		enabled: true,
	};

	it("returns empty array for null", () => {
		expect(parsePrebuildConnectors(null)).toEqual([]);
	});

	it("returns empty array for undefined", () => {
		expect(parsePrebuildConnectors(undefined)).toEqual([]);
	});

	it("returns empty array for non-array", () => {
		expect(parsePrebuildConnectors("not an array")).toEqual([]);
		expect(parsePrebuildConnectors(123)).toEqual([]);
		expect(parsePrebuildConnectors({})).toEqual([]);
	});

	it("parses a valid connector array", () => {
		const result = parsePrebuildConnectors([validConnector]);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Stripe");
		expect(result[0].transport).toBe("remote_http");
	});

	it("returns empty array for invalid connector data", () => {
		const result = parsePrebuildConnectors([{ name: "invalid" }]);
		expect(result).toEqual([]);
	});

	it("parses connector with risk policy", () => {
		const withPolicy = {
			...validConnector,
			riskPolicy: {
				defaultRisk: "read" as const,
				overrides: { dangerous_tool: "danger" as const },
			},
		};
		const result = parsePrebuildConnectors([withPolicy]);
		expect(result).toHaveLength(1);
		expect(result[0].riskPolicy?.defaultRisk).toBe("read");
		expect(result[0].riskPolicy?.overrides?.dangerous_tool).toBe("danger");
	});

	it("parses multiple connectors", () => {
		const second = {
			...validConnector,
			id: "660e8400-e29b-41d4-a716-446655440000",
			name: "Notion",
			url: "https://mcp.notion.so/v1",
		};
		const result = parsePrebuildConnectors([validConnector, second]);
		expect(result).toHaveLength(2);
	});

	it("returns empty array when array exceeds max of 20", () => {
		const tooMany = Array.from({ length: 21 }, (_, i) => ({
			...validConnector,
			id: `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, "0")}`,
		}));
		const result = parsePrebuildConnectors(tooMany);
		expect(result).toEqual([]);
	});
});

describe("ConnectorsArraySchema", () => {
	it("rejects invalid URL", () => {
		const result = ConnectorsArraySchema.safeParse([
			{
				id: "550e8400-e29b-41d4-a716-446655440000",
				name: "Bad",
				transport: "remote_http",
				url: "not-a-url",
				auth: { type: "bearer", secretKey: "KEY" },
				enabled: true,
			},
		]);
		expect(result.success).toBe(false);
	});

	it("rejects invalid auth type", () => {
		const result = ConnectorsArraySchema.safeParse([
			{
				id: "550e8400-e29b-41d4-a716-446655440000",
				name: "Bad",
				transport: "remote_http",
				url: "https://example.com",
				auth: { type: "oauth", secretKey: "KEY" },
				enabled: true,
			},
		]);
		expect(result.success).toBe(false);
	});

	it("rejects non-uuid id", () => {
		const result = ConnectorsArraySchema.safeParse([
			{
				id: "not-a-uuid",
				name: "Bad",
				transport: "remote_http",
				url: "https://example.com",
				auth: { type: "bearer", secretKey: "KEY" },
				enabled: true,
			},
		]);
		expect(result.success).toBe(false);
	});
});
