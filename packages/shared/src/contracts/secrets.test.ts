import { describe, expect, it } from "vitest";
import {
	CreateBundleInputSchema,
	CreateSecretInputSchema,
	SecretBundleSchema,
	SecretSchema,
	UpdateBundleInputSchema,
	UpdateSecretBundleInputSchema,
} from "./secrets";

describe("SecretSchema", () => {
	it("accepts a secret with bundle_id null (backward compatible)", () => {
		const result = SecretSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			key: "API_KEY",
			description: null,
			secret_type: "env",
			repo_id: null,
			bundle_id: null,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: null,
		});
		expect(result.success).toBe(true);
	});

	it("accepts a secret with bundle_id set", () => {
		const result = SecretSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			key: "DB_URL",
			description: "Database connection string",
			secret_type: "env",
			repo_id: null,
			bundle_id: "660e8400-e29b-41d4-a716-446655440001",
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-02T00:00:00.000Z",
		});
		expect(result.success).toBe(true);
	});

	it("rejects a secret without bundle_id field", () => {
		const result = SecretSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			key: "API_KEY",
			description: null,
			secret_type: "env",
			repo_id: null,
			// missing bundle_id
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: null,
		});
		expect(result.success).toBe(false);
	});
});

describe("CreateSecretInputSchema", () => {
	it("accepts input without bundleId (backward compatible)", () => {
		const result = CreateSecretInputSchema.safeParse({
			key: "MY_SECRET",
			value: "secret-value",
		});
		expect(result.success).toBe(true);
	});

	it("accepts input with bundleId", () => {
		const result = CreateSecretInputSchema.safeParse({
			key: "MY_SECRET",
			value: "secret-value",
			bundleId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid bundleId", () => {
		const result = CreateSecretInputSchema.safeParse({
			key: "MY_SECRET",
			value: "secret-value",
			bundleId: "not-a-uuid",
		});
		expect(result.success).toBe(false);
	});
});

describe("SecretBundleSchema", () => {
	it("accepts a valid bundle", () => {
		const result = SecretBundleSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			name: "Production",
			description: "Production environment secrets",
			secret_count: 5,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-02T00:00:00.000Z",
		});
		expect(result.success).toBe(true);
	});

	it("accepts a bundle with null description", () => {
		const result = SecretBundleSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			name: "Dev",
			description: null,
			secret_count: 0,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: null,
		});
		expect(result.success).toBe(true);
	});
});

describe("CreateBundleInputSchema", () => {
	it("accepts valid input", () => {
		const result = CreateBundleInputSchema.safeParse({
			name: "Production",
			description: "Prod secrets",
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty name", () => {
		const result = CreateBundleInputSchema.safeParse({
			name: "",
		});
		expect(result.success).toBe(false);
	});

	it("rejects name over 100 chars", () => {
		const result = CreateBundleInputSchema.safeParse({
			name: "a".repeat(101),
		});
		expect(result.success).toBe(false);
	});

	it("accepts without description (optional)", () => {
		const result = CreateBundleInputSchema.safeParse({
			name: "Staging",
		});
		expect(result.success).toBe(true);
	});
});

describe("UpdateBundleInputSchema", () => {
	it("accepts partial update (name only)", () => {
		const result = UpdateBundleInputSchema.safeParse({ name: "New Name" });
		expect(result.success).toBe(true);
	});

	it("accepts partial update (description only)", () => {
		const result = UpdateBundleInputSchema.safeParse({ description: "New desc" });
		expect(result.success).toBe(true);
	});

	it("accepts null description (clear)", () => {
		const result = UpdateBundleInputSchema.safeParse({ description: null });
		expect(result.success).toBe(true);
	});

	it("accepts empty object", () => {
		const result = UpdateBundleInputSchema.safeParse({});
		expect(result.success).toBe(true);
	});
});

describe("UpdateSecretBundleInputSchema", () => {
	it("accepts assigning to a bundle", () => {
		const result = UpdateSecretBundleInputSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			bundleId: "660e8400-e29b-41d4-a716-446655440001",
		});
		expect(result.success).toBe(true);
	});

	it("accepts removing from a bundle (null)", () => {
		const result = UpdateSecretBundleInputSchema.safeParse({
			id: "550e8400-e29b-41d4-a716-446655440000",
			bundleId: null,
		});
		expect(result.success).toBe(true);
	});
});
