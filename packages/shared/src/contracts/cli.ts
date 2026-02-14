import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { ErrorResponseSchema } from "./common";

const c = initContract();

// ============================================
// CLI Repos Schemas
// ============================================

const CliRepoSchema = z.object({
	id: z.string().uuid(),
	localPathHash: z.string().nullable(),
	displayName: z.string().nullable(),
});

const CliRepoConnectionSchema = z.object({
	id: z.string(),
	integrationId: z.string(),
	integration: z
		.object({
			id: z.string(),
			integration_id: z.string(),
			display_name: z.string().nullable(),
			status: z.string(),
		})
		.nullable(),
});

// ============================================
// CLI Auth Schemas
// ============================================

const DeviceCodeResponseSchema = z.object({
	userCode: z.string(),
	deviceCode: z.string(),
	verificationUrl: z.string(),
	expiresIn: z.number(),
	interval: z.number(),
});

const DeviceAuthorizeResponseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});

const DevicePollResponseSchema = z.object({
	token: z.string(),
	user: z.object({
		id: z.string().nullable(),
		email: z.string().nullable(),
		name: z.string().nullable(),
	}),
	org: z.object({
		id: z.string().nullable(),
		name: z.string().nullable(),
	}),
	hasGitHubConnection: z.boolean(),
});

const DevicePollErrorSchema = z.object({
	error: z.enum([
		"device_code is required",
		"invalid_device_code",
		"expired_token",
		"authorization_pending",
		"unknown_error",
	]),
});

// ============================================
// CLI SSH Keys Schemas
// ============================================

const SshKeySchema = z.object({
	id: z.string().uuid(),
	fingerprint: z.string(),
	name: z.string().nullable(),
	created_at: z.string().nullable(),
});

// ============================================
// CLI Sessions Schemas
// ============================================

const CliSessionSchema = z.object({
	id: z.string().uuid(),
	status: z.string().nullable(),
	session_type: z.string().nullable(),
	origin: z.string().nullable(),
	local_path_hash: z.string().nullable(),
	started_at: z.string().nullable(),
	last_activity_at: z.string().nullable(),
});

const CheckSandboxesInputSchema = z.object({
	sandboxIds: z.array(z.string()),
});

// ============================================
// CLI GitHub Schemas
// ============================================

const GitHubStatusResponseSchema = z.object({
	connected: z.boolean(),
	username: z.string().nullable(),
});

const GitHubConnectResponseSchema = z.object({
	connectUrl: z.string(),
	endUserId: z.string(),
});

const GitHubConnectStatusResponseSchema = z.object({
	connected: z.boolean(),
	connectionId: z.string().optional(),
	error: z.string().optional(),
});

// ============================================
// CLI Prebuilds Schemas
// ============================================

const CliPrebuildSchema = z.object({
	id: z.string().uuid(),
	snapshot_id: z.string().nullable(),
	user_id: z.string().nullable(),
	local_path_hash: z.string().nullable(),
	created_at: z.string().nullable(),
	sandbox_provider: z.string().nullable(),
});

const CreateCliPrebuildInputSchema = z.object({
	localPathHash: z.string(),
	sessionId: z.string(),
	sandboxId: z.string(),
});

// ============================================
// Contract
// ============================================

export const cliContract = c.router(
	{
		// ====================================
		// CLI Repos
		// ====================================
		repos: {
			get: {
				method: "GET",
				path: "/cli/repos",
				query: z.object({
					localPathHash: z.string(),
				}),
				responses: {
					200: z.object({
						repo: CliRepoSchema.nullable(),
						connection: CliRepoConnectionSchema.nullable(),
					}),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Get local repo by path hash",
			},

			create: {
				method: "POST",
				path: "/cli/repos",
				body: z.object({
					localPathHash: z.string(),
					displayName: z.string().optional(),
					integrationId: z.string().optional(),
				}),
				responses: {
					200: z.object({
						success: z.boolean(),
						repoId: z.string().uuid(),
						integrationId: z.string().nullable(),
					}),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Create a local repo and optionally link to integration",
			},

			deleteAll: {
				method: "DELETE",
				path: "/cli/repos",
				body: c.noBody(),
				responses: {
					200: z.object({
						success: z.boolean(),
						deleted: z.number(),
					}),
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Delete all local repos for the organization",
			},
		},

		// ====================================
		// CLI Auth
		// ====================================
		auth: {
			createDeviceCode: {
				method: "POST",
				path: "/cli/auth/device",
				body: c.noBody(),
				responses: {
					200: DeviceCodeResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Create a new device authorization request",
			},

			authorizeDevice: {
				method: "POST",
				path: "/cli/auth/device/authorize",
				body: z.object({
					userCode: z.string(),
				}),
				responses: {
					200: DeviceAuthorizeResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Authorize a device code (called from /device page)",
			},

			pollDevice: {
				method: "POST",
				path: "/cli/auth/device/poll",
				body: z.object({
					deviceCode: z.string(),
				}),
				responses: {
					200: DevicePollResponseSchema,
					400: DevicePollErrorSchema,
					500: DevicePollErrorSchema,
				},
				summary: "Poll for device authorization status",
			},
		},

		// ====================================
		// CLI SSH Keys
		// ====================================
		sshKeys: {
			list: {
				method: "GET",
				path: "/cli/ssh-keys",
				responses: {
					200: z.object({ keys: z.array(SshKeySchema) }),
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "List all SSH keys for the user",
			},

			create: {
				method: "POST",
				path: "/cli/ssh-keys",
				body: z.object({
					publicKey: z.string(),
					name: z.string().optional(),
				}),
				responses: {
					200: z.object({ key: SshKeySchema }),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					409: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Upload a new SSH public key",
			},

			deleteAll: {
				method: "DELETE",
				path: "/cli/ssh-keys",
				body: c.noBody(),
				responses: {
					200: z.object({ success: z.boolean() }),
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Delete all SSH keys for the user",
			},

			delete: {
				method: "DELETE",
				path: "/cli/ssh-keys/:id",
				pathParams: z.object({
					id: z.string().uuid(),
				}),
				body: c.noBody(),
				responses: {
					200: z.object({ success: z.boolean() }),
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Delete a specific SSH key by ID",
			},
		},

		// ====================================
		// CLI Sessions
		// ====================================
		sessions: {
			list: {
				method: "GET",
				path: "/cli/sessions",
				query: z.object({
					localPathHash: z.string().optional(),
				}),
				responses: {
					200: z.object({ sessions: z.array(CliSessionSchema) }),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "List CLI sessions, optionally filtered by local path hash",
			},

			deleteAll: {
				method: "DELETE",
				path: "/cli/sessions",
				body: c.noBody(),
				responses: {
					200: z.object({
						success: z.boolean(),
						terminated: z.number(),
					}),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Terminate all CLI sessions for the organization",
			},

			get: {
				method: "GET",
				path: "/cli/sessions/:id",
				pathParams: z.object({
					id: z.string().uuid(),
				}),
				responses: {
					200: z.object({
						session: z.record(z.unknown()),
					}),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
				},
				summary: "Get a specific CLI session's details",
			},

			delete: {
				method: "DELETE",
				path: "/cli/sessions/:id",
				pathParams: z.object({
					id: z.string().uuid(),
				}),
				body: c.noBody(),
				responses: {
					200: z.object({
						success: z.boolean(),
						message: z.string().optional(),
					}),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Terminate a specific CLI session",
			},

			checkSandboxes: {
				method: "POST",
				path: "/cli/sessions/check",
				body: CheckSandboxesInputSchema,
				responses: {
					200: z.object({
						alive: z.array(z.string()),
						count: z.number(),
					}),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
					501: ErrorResponseSchema,
				},
				summary: "Check which sandboxes are still alive",
			},
		},

		// ====================================
		// CLI GitHub
		// ====================================
		github: {
			status: {
				method: "GET",
				path: "/cli/github/status",
				responses: {
					200: GitHubStatusResponseSchema,
					401: ErrorResponseSchema,
				},
				summary: "Check if the organization has a GitHub connection",
			},

			connect: {
				method: "POST",
				path: "/cli/github/connect",
				body: c.noBody(),
				responses: {
					200: GitHubConnectResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Create a Nango Connect Session for GitHub OAuth",
			},

			connectStatus: {
				method: "GET",
				path: "/cli/github/connect/status",
				responses: {
					200: GitHubConnectStatusResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
				},
				summary: "Poll for GitHub connection status",
			},

			select: {
				method: "POST",
				path: "/cli/github/select",
				body: z.object({
					connectionId: z.string(),
				}),
				responses: {
					200: z.object({ success: z.boolean() }),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Store user's GitHub connection selection for CLI polling",
			},
		},

		// ====================================
		// CLI Prebuilds
		// ====================================
		prebuilds: {
			get: {
				method: "GET",
				path: "/cli/prebuilds",
				query: z.object({
					localPathHash: z.string(),
				}),
				responses: {
					200: z.object({ prebuild: CliPrebuildSchema.nullable() }),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Look up prebuild by local path hash",
			},

			create: {
				method: "POST",
				path: "/cli/prebuilds",
				body: CreateCliPrebuildInputSchema,
				responses: {
					200: z.object({
						prebuild: CliPrebuildSchema,
						snapshotId: z.string(),
					}),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Create or update a prebuild (snapshot cache)",
			},

			delete: {
				method: "DELETE",
				path: "/cli/prebuilds",
				query: z.object({
					localPathHash: z.string(),
				}),
				body: c.noBody(),
				responses: {
					200: z.object({ success: z.boolean() }),
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
				summary: "Delete a prebuild by local path hash",
			},
		},
	},
	{
		pathPrefix: "/api",
	},
);

// Export schemas for external use
export {
	CliRepoSchema,
	CliRepoConnectionSchema,
	DeviceCodeResponseSchema,
	DevicePollResponseSchema,
	SshKeySchema,
	CliSessionSchema,
	CliPrebuildSchema,
};
