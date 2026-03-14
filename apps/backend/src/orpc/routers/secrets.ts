/**
 * Secrets router implementation.
 */

import { ORPCError } from "@orpc/server";
import { secrets } from "@proliferate/services";
import { orpc } from "../contract";
import { orgMiddleware } from "../middleware";

export const secretsRouter = {
	list: orpc.secrets.list.use(orgMiddleware).handler(async ({ context }) => {
		const secretsList = await secrets.listSecrets(context.orgId);
		return { secrets: secretsList };
	}),

	create: orpc.secrets.create.use(orgMiddleware).handler(async ({ input, context }) => {
		return secrets.createSecret(context.orgId, input.key, input.value);
	}),

	delete: orpc.secrets.delete.use(orgMiddleware).handler(async ({ input, context }) => {
		const deleted = await secrets.deleteSecret(input.id, context.orgId);
		if (!deleted) throw new ORPCError("NOT_FOUND", { message: "Secret not found" });
		return { success: true };
	}),

	updateValue: orpc.secrets.updateValue.use(orgMiddleware).handler(async ({ input, context }) => {
		const updated = await secrets.updateSecretValue(input.id, context.orgId, input.value);
		if (!updated) throw new ORPCError("NOT_FOUND", { message: "Secret not found" });
		return { success: true };
	}),

	addRepoBinding: orpc.secrets.addRepoBinding
		.use(orgMiddleware)
		.handler(async ({ input, context }) => {
			const added = await secrets.addRepoBinding(input.secretId, input.repoId, context.orgId);
			if (!added) throw new ORPCError("BAD_REQUEST", { message: "Binding failed" });
			return { success: true };
		}),

	removeRepoBinding: orpc.secrets.removeRepoBinding
		.use(orgMiddleware)
		.handler(async ({ input, context }) => {
			const removed = await secrets.removeRepoBinding(
				input.secretId,
				input.repoId,
				context.orgId,
			);
			if (!removed) throw new ORPCError("NOT_FOUND", { message: "Binding not found" });
			return { success: true };
		}),
};
