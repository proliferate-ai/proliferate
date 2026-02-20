import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

// ============================================
// Schemas
// ============================================

export const ConfigurationRepoSchema = z.object({
	workspacePath: z.string(),
	repo: z
		.object({
			id: z.string(),
			githubRepoName: z.string(),
			githubUrl: z.string(),
		})
		.nullable(),
});

export const SetupSessionSchema = z.object({
	id: z.string(),
	sessionType: z.string().nullable(),
	status: z.string().nullable(),
});

export const ConfigurationSchema = z.object({
	id: z.string().uuid(),
	snapshotId: z.string().nullable(),
	status: z.string().nullable(),
	name: z.string().nullable(),
	notes: z.string().nullable(),
	routingDescription: z.string().nullable().optional(),
	createdAt: z.string().nullable(),
	createdBy: z.string().nullable(),
	sandboxProvider: z.string().nullable(),
	configurationRepos: z.array(ConfigurationRepoSchema).optional(),
	setupSessions: z.array(SetupSessionSchema).optional(),
});

export type Configuration = z.infer<typeof ConfigurationSchema>;

export const CreateConfigurationInputSchema = z.object({
	repoIds: z.array(z.string().uuid()).optional(),
	// Legacy format support
	repos: z
		.array(
			z.object({
				repoId: z.string(),
				workspacePath: z.string().optional(),
			}),
		)
		.optional(),
	name: z.string().optional(),
});

export const UpdateConfigurationInputSchema = z.object({
	name: z.string().optional(),
	notes: z.string().optional(),
	routingDescription: z.string().nullable().optional(),
});

// ============================================
// Contract
// ============================================

export const configurationsContract = c.router(
	{
		list: {
			method: "GET",
			path: "/configurations",
			query: z.object({
				status: z.string().optional(),
			}),
			responses: {
				200: z.object({ configurations: z.array(ConfigurationSchema) }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "List configurations for the current organization",
		},

		create: {
			method: "POST",
			path: "/configurations",
			body: CreateConfigurationInputSchema,
			responses: {
				200: z.object({
					configurationId: z.string().uuid(),
					repos: z.number(),
				}),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Create a new configuration with multiple repos",
		},

		update: {
			method: "PATCH",
			path: "/configurations/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: UpdateConfigurationInputSchema,
			responses: {
				200: z.object({ configuration: ConfigurationSchema }),
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Update a configuration (name, notes)",
		},

		delete: {
			method: "DELETE",
			path: "/configurations/:id",
			pathParams: z.object({
				id: z.string().uuid(),
			}),
			body: c.noBody(),
			responses: {
				200: z.object({ success: z.boolean() }),
				401: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
			summary: "Delete a configuration",
		},
	},
	{
		pathPrefix: "/api",
	},
);
