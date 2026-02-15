import { describe, expect, it } from "vitest";
import {
	BulkImportInputSchema,
	BulkImportResultSchema,
	CreateSecretInputSchema,
	SecretSchema,
} from "./secrets";

describe("SecretSchema", () => {
	it("accepts a valid secret", () => {
		const result = SecretSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			key: "API_KEY",
			description: null,
			secret_type: "env",
			repo_id: null,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: null,
		});
		expect(result.success).toBe(true);
	});

	it("accepts a secret with all fields set", () => {
		const result = SecretSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			key: "DB_URL",
			description: "Database connection string",
			secret_type: "env",
			repo_id: null,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-02T00:00:00.000Z",
		});
		expect(result.success).toBe(true);
	});
});

describe("CreateSecretInputSchema", () => {
	it("accepts minimal input", () => {
		const result = CreateSecretInputSchema.safeParse({
			key: "MY_SECRET",
			value: "secret-value",
		});
		expect(result.success).toBe(true);
	});

	it("accepts input with optional fields", () => {
		const result = CreateSecretInputSchema.safeParse({
			key: "MY_SECRET",
			value: "secret-value",
			description: "A secret",
			repoId: "550e8400-e29b-41d4-a716-446655440000",
			secretType: "env",
		});
		expect(result.success).toBe(true);
	});
});

describe("BulkImportInputSchema", () => {
	it("accepts envText only", () => {
		const result = BulkImportInputSchema.safeParse({
			envText: "KEY=value\nOTHER=123",
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing envText", () => {
		const result = BulkImportInputSchema.safeParse({});
		expect(result.success).toBe(false);
	});
});

describe("BulkImportResultSchema", () => {
	it("accepts valid result", () => {
		const result = BulkImportResultSchema.safeParse({
			created: 3,
			skipped: ["EXISTING_KEY"],
		});
		expect(result.success).toBe(true);
	});

	it("accepts empty skipped array", () => {
		const result = BulkImportResultSchema.safeParse({
			created: 5,
			skipped: [],
		});
		expect(result.success).toBe(true);
	});
});
