import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	CreateSecretInputSchema,
	SecretRepoBindingInputSchema,
	SecretSchema,
	UpdateSecretValueInputSchema,
} from "../schemas/secrets";

export const secretsContract = {
	list: oc
		.input(z.object({}).optional())
		.output(z.object({ secrets: z.array(SecretSchema) })),

	create: oc.input(CreateSecretInputSchema).output(SecretSchema),

	delete: oc.input(z.object({ id: z.string() })).output(z.object({ success: z.boolean() })),

	updateValue: oc
		.input(UpdateSecretValueInputSchema)
		.output(z.object({ success: z.boolean() })),

	addRepoBinding: oc
		.input(SecretRepoBindingInputSchema)
		.output(z.object({ success: z.boolean() })),

	removeRepoBinding: oc
		.input(SecretRepoBindingInputSchema)
		.output(z.object({ success: z.boolean() })),
};
