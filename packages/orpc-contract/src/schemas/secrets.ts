import { z } from "zod";

export const SecretSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	key: z.string(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
	repoBindings: z.array(
		z.object({
			id: z.string(),
			repoId: z.string(),
		}),
	),
});

export const CreateSecretInputSchema = z.object({
	key: z.string().min(1),
	value: z.string().min(1),
});

export const UpdateSecretValueInputSchema = z.object({
	id: z.string(),
	value: z.string().min(1),
});

export const SecretRepoBindingInputSchema = z.object({
	secretId: z.string(),
	repoId: z.string(),
});
