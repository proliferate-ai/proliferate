import { oc } from "@orpc/contract";
import { z } from "zod";
import { CreateRepoInputSchema, RepoSchema, RepoSnapshotSchema } from "../schemas/repos";

export const reposContract = {
	list: oc
		.input(z.object({}).optional())
		.output(z.object({ repos: z.array(RepoSchema) })),

	get: oc.input(z.object({ id: z.string() })).output(RepoSchema),

	create: oc.input(CreateRepoInputSchema).output(RepoSchema),

	delete: oc.input(z.object({ id: z.string() })).output(z.object({ success: z.boolean() })),

	listSnapshots: oc
		.input(z.object({ repoId: z.string() }))
		.output(z.object({ snapshots: z.array(RepoSnapshotSchema) })),
};
