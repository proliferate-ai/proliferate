import { describe, expect, it } from "vitest";
import { CreateSecretInputSchema, SecretSchema } from "./secrets";

describe("SecretSchema", () => {
	it("accepts a secret with configuration_id null", () => {
		const result = SecretSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			key: "API_KEY",
			description: null,
			secret_type: "env",
			repo_id: null,
			configuration_id: null,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: null,
		});
		expect(result.success).toBe(true);
	});

	it("accepts a secret with configuration_id set", () => {
		const result = SecretSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			key: "DB_URL",
			description: "Database connection string",
			secret_type: "env",
			repo_id: null,
			configuration_id: "660e8400-e29b-41d4-a716-446655440001",
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-02T00:00:00.000Z",
		});
		expect(result.success).toBe(true);
	});

	it("rejects a secret without configuration_id field", () => {
		const result = SecretSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			key: "API_KEY",
			description: null,
			secret_type: "env",
			repo_id: null,
			// missing configuration_id
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: null,
		});
		expect(result.success).toBe(false);
	});
});

describe("CreateSecretInputSchema", () => {
	it("accepts input without configurationId (backward compatible)", () => {
		const result = CreateSecretInputSchema.safeParse({
			key: "MY_SECRET",
			value: "secret-value",
		});
		expect(result.success).toBe(true);
	});

	it("accepts input with configurationId", () => {
		const result = CreateSecretInputSchema.safeParse({
			key: "MY_SECRET",
			value: "secret-value",
			configurationId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid configurationId", () => {
		const result = CreateSecretInputSchema.safeParse({
			key: "MY_SECRET",
			value: "secret-value",
			configurationId: "not-a-uuid",
		});
		expect(result.success).toBe(false);
	});
});
