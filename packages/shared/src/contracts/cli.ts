import { z } from "zod";

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
// CLI Configurations Schemas
// ============================================

const CliConfigurationSchema = z.object({
	id: z.string().uuid(),
	snapshot_id: z.string().nullable(),
	user_id: z.string().nullable(),
	local_path_hash: z.string().nullable(),
	created_at: z.string().nullable(),
	sandbox_provider: z.string().nullable(),
});

const CreateCliConfigurationInputSchema = z.object({
	localPathHash: z.string(),
	sessionId: z.string(),
	sandboxId: z.string(),
});
