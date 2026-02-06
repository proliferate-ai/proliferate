/**
 * Sessions Route
 *
 * POST /proliferate/sessions - Unified session creation endpoint
 */

import { prebuilds, sessions } from "@proliferate/services";
import type { CloneInstructions } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import type { Router as RouterType } from "express";
import { Router } from "express";
import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";
import {
	clearIdempotencyKey,
	readIdempotencyResponse,
	reserveIdempotencyKey,
	storeIdempotencyResponse,
} from "../../../lib/idempotency";
import { type PrebuildResolutionOptions, resolvePrebuild } from "../../../lib/prebuild-resolver";
import {
	type ClientType,
	type SandboxMode,
	type SessionType,
	createSession,
} from "../../../lib/session-creator";
import { ApiError } from "../../../middleware";

/**
 * Request body for session creation
 */
interface CreateSessionRequest {
	organizationId: string;

	// Prebuild resolution (exactly one required)
	prebuildId?: string;
	managedPrebuild?: { repoIds?: string[] };
	cliPrebuild?: { localPathHash: string; displayName?: string };

	// Session config
	sessionType: SessionType;
	clientType: ClientType;
	clientMetadata?: Record<string, unknown>;

	// Options
	sandboxMode?: SandboxMode;
	snapshotId?: string;
	initialPrompt?: string;
	title?: string;
	agentConfig?: { modelId?: string };
	automationId?: string;
	triggerId?: string;
	triggerEventId?: string;
	/** Trigger context written to .proliferate/trigger-context.json in sandbox */
	triggerContext?: Record<string, unknown>;

	// SSH access (can be enabled on any session type)
	sshOptions?: {
		publicKeys: string[];
		cloneInstructions?: CloneInstructions;
		localPath?: string;
		gitToken?: string;
		envVars?: Record<string, string>;
	};
}

/**
 * Response for session creation
 */
interface CreateSessionResponse {
	sessionId: string;
	prebuildId: string;
	status: "pending" | "starting" | "running";
	gatewayUrl: string;
	hasSnapshot: boolean;
	isNewPrebuild: boolean;
	sandbox?: {
		sandboxId: string;
		previewUrl: string | null;
		sshHost?: string;
		sshPort?: number;
	};
}

/**
 * Create the sessions router
 */
export function createSessionsRouter(env: GatewayEnv, hubManager: HubManager): RouterType {
	const router: RouterType = Router();
	const provider = getSandboxProvider();

	// Gateway URL for responses
	const gatewayUrl = env.gatewayUrl;

	router.post("/", async (req, res, next) => {
		let idempotencyState: { orgId: string; key: string } | null = null;
		try {
			const auth = req.auth;
			if (!auth) {
				throw new ApiError(401, "Authentication required");
			}
			const orgId = auth.orgId;
			if (!orgId) {
				throw new ApiError(401, "Organization required");
			}

			const body = req.body as CreateSessionRequest;

			// Validate required fields
			if (!body.organizationId) {
				throw new ApiError(400, "organizationId is required");
			}
			if (!body.sessionType) {
				throw new ApiError(400, "sessionType is required");
			}
			if (!body.clientType) {
				throw new ApiError(400, "clientType is required");
			}

			// Validate exactly one prebuild option is provided
			const prebuildOptions = [body.prebuildId, body.managedPrebuild, body.cliPrebuild].filter(
				Boolean,
			);
			if (prebuildOptions.length === 0) {
				throw new ApiError(400, "One of prebuildId, managedPrebuild, or cliPrebuild is required");
			}
			if (prebuildOptions.length > 1) {
				throw new ApiError(
					400,
					"Only one of prebuildId, managedPrebuild, or cliPrebuild can be provided",
				);
			}

			// Validate SSH options
			if (body.sshOptions && !body.sshOptions.publicKeys?.length) {
				throw new ApiError(400, "sshOptions.publicKeys is required when SSH is enabled");
			}

			// For CLI auth, use the org from the token if not provided
			const organizationId = body.organizationId || auth.orgId;
			if (!organizationId) {
				throw new ApiError(400, "organizationId is required");
			}

			const idempotencyKey = req.header("Idempotency-Key");
			if (idempotencyKey) {
				const existing = await readIdempotencyResponse(organizationId, idempotencyKey);
				if (existing) {
					res.status(201).json(existing as CreateSessionResponse);
					return;
				}

				const reservation = await reserveIdempotencyKey(organizationId, idempotencyKey);
				if (reservation === "exists") {
					const replay = await readIdempotencyResponse(organizationId, idempotencyKey);
					if (replay) {
						res.status(201).json(replay as CreateSessionResponse);
						return;
					}
				}
				if (reservation === "in_flight") {
					throw new ApiError(409, "Idempotent request already in progress");
				}
				idempotencyState = { orgId: organizationId, key: idempotencyKey };
			}

			// Resolve prebuild
			const prebuildResolutionOptions: PrebuildResolutionOptions = {
				organizationId,
				provider,
				userId: auth.userId,
				prebuildId: body.prebuildId,
				managedPrebuild: body.managedPrebuild,
				cliPrebuild: body.cliPrebuild,
			};

			console.log(`[Sessions] Resolving prebuild for org ${organizationId.slice(0, 8)}`);

			const prebuild = await resolvePrebuild(prebuildResolutionOptions);

			console.log("[Sessions] Prebuild resolved:", {
				prebuildId: prebuild.id.slice(0, 8),
				isNew: prebuild.isNew,
				hasSnapshot: Boolean(prebuild.snapshotId),
			});

			// Create session
			const result = await createSession(
				{
					env,
					provider,
					organizationId,
					prebuildId: prebuild.id,
					sessionType: body.sessionType,
					clientType: body.clientType,
					userId: auth.userId,
					snapshotId: body.snapshotId || prebuild.snapshotId,
					initialPrompt: body.initialPrompt,
					title: body.title,
					clientMetadata: body.clientMetadata,
					agentConfig: body.agentConfig,
					sandboxMode: body.sandboxMode,
					automationId: body.automationId,
					triggerId: body.triggerId,
					triggerEventId: body.triggerEventId,
					triggerContext: body.triggerContext,
					sshOptions: body.sshOptions
						? {
								...body.sshOptions,
								localPathHash: body.cliPrebuild?.localPathHash,
							}
						: undefined,
				},
				prebuild.isNew,
			);

			console.log("[Sessions] Session created:", {
				sessionId: result.sessionId.slice(0, 8),
				status: result.status,
				hasSandbox: Boolean(result.sandbox),
			});

			// For new managed prebuilds, kick off setup session
			if (prebuild.isNew && body.managedPrebuild) {
				await startSetupSession(prebuild.id, organizationId, hubManager);
			}

			const response: CreateSessionResponse = {
				sessionId: result.sessionId,
				prebuildId: result.prebuildId,
				status: result.status,
				gatewayUrl,
				hasSnapshot: result.hasSnapshot,
				isNewPrebuild: result.isNewPrebuild,
				sandbox: result.sandbox,
			};

			if (idempotencyState) {
				await storeIdempotencyResponse(idempotencyState.orgId, idempotencyState.key, response);
			}

			res.status(201).json(response);
		} catch (err) {
			if (idempotencyState) {
				await clearIdempotencyKey(idempotencyState.orgId, idempotencyState.key);
			}
			next(err);
		}
	});

	router.get("/:sessionId/status", async (req, res, next) => {
		try {
			const auth = req.auth;
			if (!auth) {
				throw new ApiError(401, "Authentication required");
			}
			const orgId = auth.orgId;
			if (!orgId) {
				throw new ApiError(401, "Organization required");
			}

			const sessionId = req.params.sessionId;
			const session = await sessions.getFullSession(sessionId, orgId);
			if (!session) {
				throw new ApiError(404, "Session not found");
			}

			const terminated = session.status === "stopped" || Boolean(session.endedAt);

			res.json({
				state: terminated ? "terminated" : "running",
				status: session.status ?? "unknown",
				terminatedAt: session.endedAt?.toISOString(),
				reason: session.stopReason ?? undefined,
			});
		} catch (err) {
			next(err);
		}
	});

	return router;
}

/**
 * Start a setup session for a new managed prebuild
 */
async function startSetupSession(
	prebuildId: string,
	organizationId: string,
	hubManager: HubManager,
): Promise<void> {
	// Get repo names for prompt
	const prebuildRepos = await prebuilds.getPrebuildReposWithDetails(prebuildId);

	const repoNames =
		prebuildRepos?.filter((pr) => pr.repo !== null).map((pr) => pr.repo!.githubRepoName) || [];

	const repoNamesStr = repoNames.join(", ") || "workspace";
	const prompt = `Set up ${repoNamesStr} for development. Get everything running and working.`;

	// Create setup session
	const sessionId = crypto.randomUUID();

	await sessions.createSetupSession({
		id: sessionId,
		prebuildId,
		organizationId,
		initialPrompt: prompt,
	});

	// Use HubManager to get/create hub and post prompt directly (fire-and-forget)
	hubManager
		.getOrCreate(sessionId)
		.then((hub) => {
			hub.postPrompt(prompt, "managed-prebuild-setup");
		})
		.catch((err) => {
			console.error("[Sessions] Failed to start setup session:", err);
		});
}
