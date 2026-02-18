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
	configurationId: z.string().uuid().optional(),
});

export type CreateSecretInput = z.infer<typeof CreateSecretInputSchema>;

export const CheckSecretsInputSchema = z.object({
	keys: z.array(z.string()),
	repo_id: z.string().uuid().optional(),
	configuration_id: z.string().uuid().optional(),
});

export type CheckSecretsInput = z.infer<typeof CheckSecretsInputSchema>;

export const CheckSecretsResultSchema = z.object({
	key: z.string(),
	exists: z.boolean(),
});

// ============================================
// Bulk Import Schemas
// ============================================

export const BulkImportInputSchema = z.object({
	envText: z.string().min(1),
});

export type BulkImportInput = z.infer<typeof BulkImportInputSchema>;

export const BulkImportResultSchema = z.object({
	created: z.number().int(),
	skipped: z.array(z.string()),
});

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
