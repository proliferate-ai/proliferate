import { describe, expect, it } from "vitest";
import { schemaToParams } from "./client";

describe("schemaToParams", () => {
	it("returns empty array for undefined input", () => {
		expect(schemaToParams(undefined)).toEqual([]);
	});

	it("returns empty array when properties is missing", () => {
		expect(schemaToParams({})).toEqual([]);
	});

	it("returns empty array for empty properties", () => {
		expect(schemaToParams({ properties: {} })).toEqual([]);
	});

	it("maps string properties", () => {
		const result = schemaToParams({
			properties: {
				name: { type: "string", description: "The name" },
			},
			required: ["name"],
		});
		expect(result).toEqual([
			{ name: "name", type: "string", required: true, description: "The name" },
		]);
	});

	it("maps number and integer properties", () => {
		const result = schemaToParams({
			properties: {
				count: { type: "number", description: "Count" },
				limit: { type: "integer", description: "Limit" },
			},
		});
		expect(result).toEqual([
			{ name: "count", type: "number", required: false, description: "Count" },
			{ name: "limit", type: "number", required: false, description: "Limit" },
		]);
	});

	it("maps boolean properties", () => {
		const result = schemaToParams({
			properties: {
				active: { type: "boolean", description: "Is active" },
			},
		});
		expect(result).toEqual([
			{ name: "active", type: "boolean", required: false, description: "Is active" },
		]);
	});

	it("maps unknown types to object", () => {
		const result = schemaToParams({
			properties: {
				data: { type: "array", description: "Array data" },
			},
		});
		expect(result).toEqual([
			{ name: "data", type: "object", required: false, description: "Array data" },
		]);
	});

	it("defaults description to empty string when missing", () => {
		const result = schemaToParams({
			properties: {
				field: { type: "string" },
			},
		});
		expect(result).toEqual([{ name: "field", type: "string", required: false, description: "" }]);
	});

	it("marks required fields correctly", () => {
		const result = schemaToParams({
			properties: {
				required_field: { type: "string", description: "Required" },
				optional_field: { type: "string", description: "Optional" },
			},
			required: ["required_field"],
		});
		expect(result).toHaveLength(2);
		const req = result.find((p) => p.name === "required_field");
		const opt = result.find((p) => p.name === "optional_field");
		expect(req?.required).toBe(true);
		expect(opt?.required).toBe(false);
	});

	it("handles missing required array", () => {
		const result = schemaToParams({
			properties: {
				field: { type: "string", description: "A field" },
			},
		});
		expect(result[0].required).toBe(false);
	});
});
