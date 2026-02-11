import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

// ============================================
// Schemas
// ============================================

export const SecretSchema = z.object({
	id: z.string().uuid(),
	key: z.string(),
	description: z.string().nullable(),
	secret_type: z.string().nullable(),
	repo_id: z.string().uuid().nullable(),
	bundle_id: z.string().uuid().nullable(),
	created_at: z.string().nullable(),
	updated_at: z.string().nullable(),
});

export type Secret = z.infer<typeof SecretSchema>;

export const CreateSecretInputSchema = z.object({
	key: z.string(),
	value: z.string(),
	description: z.string().optional(),
	repoId: z.string().uuid().optional(),
	secretType: z.string().optional(),
	bundleId: z.string().uuid().optional(),
});

export type CreateSecretInput = z.infer<typeof CreateSecretInputSchema>;

export const UpdateSecretBundleInputSchema = z.object({
	id: z.string().uuid(),
	bundleId: z.string().uuid().nullable(),
});

export type UpdateSecretBundleInput = z.infer<typeof UpdateSecretBundleInputSchema>;

export const CheckSecretsInputSchema = z.object({
	keys: z.array(z.string()),
	repo_id: z.string().uuid().optional(),
	prebuild_id: z.string().uuid().optional(),
});

export type CheckSecretsInput = z.infer<typeof CheckSecretsInputSchema>;

export const CheckSecretsResultSchema = z.object({
	key: z.string(),
	exists: z.boolean(),
});

// ============================================
// Bundle Schemas
// ============================================

export const SecretBundleSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	description: z.string().nullable(),
	secret_count: z.number().int(),
	created_at: z.string().nullable(),
	updated_at: z.string().nullable(),
});

export type SecretBundle = z.infer<typeof SecretBundleSchema>;

export const CreateBundleInputSchema = z.object({
	name: z.string().min(1).max(100),
	description: z.string().optional(),
});

export type CreateBundleInput = z.infer<typeof CreateBundleInputSchema>;

export const UpdateBundleInputSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	description: z.string().nullable().optional(),
});

export type UpdateBundleInput = z.infer<typeof UpdateBundleInputSchema>;

// ============================================
// Contract
// ============================================

export const secretsContract = c.router(
	{
		list: {
			method: "GET",
			path: "/secrets",
			responses: {
				200: z.object({ secrets: z.array(SecretSchema) }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List secrets for the current organization (values not returned)",
		},

		create: {
			method: "POST",
			path: "/secrets",
			body: CreateSecretInputSchema,
			responses: {
				200: z.object({
					secret: SecretSchema.omit({ updated_at: true }),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				409: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Create a new secret (value is encrypted)",
		},

		delete: {
			method: "DELETE",
			path: "/secrets/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({ deleted: z.boolean() }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Delete a secret",
		},

		check: {
			method: "POST",
			path: "/secrets/check",
			body: CheckSecretsInputSchema,
			responses: {
				200: z.object({
					keys: z.array(CheckSecretsResultSchema),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Check which secrets exist for given keys",
		},
	},
	{
		pathPrefix: "/api",
	},
);
