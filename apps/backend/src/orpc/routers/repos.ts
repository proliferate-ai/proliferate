/**
 * Repos router implementation.
 */

import { ORPCError } from "@orpc/server";
import { repos } from "@proliferate/services";
import { orpc } from "../contract";
import { orgMiddleware } from "../middleware";

export const reposRouter = {
	list: orpc.repos.list.use(orgMiddleware).handler(async ({ context }) => {
		const reposList = await repos.listRepos(context.orgId);
		return { repos: reposList };
	}),

	get: orpc.repos.get.use(orgMiddleware).handler(async ({ input, context }) => {
		const repo = await repos.getRepo(input.id, context.orgId);
		if (!repo) throw new ORPCError("NOT_FOUND", { message: "Repo not found" });
		return repo;
	}),

	create: orpc.repos.create.use(orgMiddleware).handler(async ({ input, context }) => {
		return repos.createRepo(context.orgId, input);
	}),

	delete: orpc.repos.delete.use(orgMiddleware).handler(async ({ input, context }) => {
		const deleted = await repos.deleteRepo(input.id, context.orgId);
		if (!deleted) throw new ORPCError("NOT_FOUND", { message: "Repo not found" });
		return { success: true };
	}),

	listSnapshots: orpc.repos.listSnapshots.use(orgMiddleware).handler(async ({ input, context }) => {
		const snapshots = await repos.listSnapshots(input.repoId, context.orgId);
		if (!snapshots) throw new ORPCError("NOT_FOUND", { message: "Repo not found" });
		return { snapshots };
	}),
};
