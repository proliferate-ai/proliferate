import { z } from "zod";

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
