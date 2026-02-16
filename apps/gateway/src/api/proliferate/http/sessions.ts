/**
 * Sessions Route
 *
 * POST /proliferate/sessions - Unified session creation endpoint
 */

import { createLogger } from "@proliferate/logger";
import { billing, prebuilds, sessions } from "@proliferate/services";
import { getSandboxProvider } from "@proliferate/shared/providers";
import type { Router as RouterType } from "express";
import { Router } from "express";
import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";

const logger = createLogger({ service: "gateway" }).child({ module: "sessions-route" });
import {
	IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS,
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
		const requestStartMs = Date.now();
		try {
			const auth = req.auth;
			if (!auth) {
				throw new ApiError(401, "Authentication required");
			}

			const body = req.body as CreateSessionRequest;

			// Service auth can use body.organizationId; user/CLI auth must have orgId on the token
			const organizationId = auth.orgId ?? body.organizationId;
			if (!organizationId) {
				throw new ApiError(401, "Organization required");
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

			logger.debug(
				{
					orgId: organizationId.slice(0, 8),
					sessionType: body.sessionType,
					clientType: body.clientType,
					sandboxMode: body.sandboxMode || "deferred",
					hasIdempotencyKey: Boolean(req.header("Idempotency-Key")),
					hasSnapshot: Boolean(body.snapshotId),
					sshEnabled: Boolean(body.sshOptions),
				},
				"sessions.create.start",
			);

			const idempotencyKey = req.header("Idempotency-Key");
			if (idempotencyKey) {
				const idempotencyStartMs = Date.now();
				const existing = await readIdempotencyResponse(organizationId, idempotencyKey);
				if (existing) {
					logger.debug(
						{
							orgId: organizationId.slice(0, 8),
							durationMs: Date.now() - idempotencyStartMs,
						},
						"sessions.create.idempotency.replay",
					);
					res.status(201).json(existing as CreateSessionResponse);
					return;
				}

				const reservation = await reserveIdempotencyKey(organizationId, idempotencyKey);
				logger.debug(
					{
						orgId: organizationId.slice(0, 8),
						result: reservation,
						durationMs: Date.now() - idempotencyStartMs,
						inFlightTtlSeconds: IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS,
					},
					"sessions.create.idempotency.reserve",
				);
				if (reservation === "exists") {
					const replay = await readIdempotencyResponse(organizationId, idempotencyKey);
					if (replay) {
						logger.debug(
							{
								orgId: organizationId.slice(0, 8),
								durationMs: Date.now() - idempotencyStartMs,
							},
							"sessions.create.idempotency.replay",
						);
						res.status(201).json(replay as CreateSessionResponse);
						return;
					}
				}
				if (reservation === "in_flight") {
					throw new ApiError(409, "Idempotent request already in progress");
				}
				idempotencyState = { orgId: organizationId, key: idempotencyKey };
			}

			// Billing gate — blocks automations and API clients when org is out of credits
			const operation = body.automationId ? "automation_trigger" : "session_start";
			await billing.assertBillingGateForOrg(organizationId, operation);

			// Resolve prebuild
			const prebuildResolutionOptions: PrebuildResolutionOptions = {
				organizationId,
				provider,
				userId: auth.userId,
				prebuildId: body.prebuildId,
				managedPrebuild: body.managedPrebuild,
				cliPrebuild: body.cliPrebuild,
			};

			logger.info({ orgId: organizationId.slice(0, 8) }, "Resolving prebuild");

			const prebuildStartMs = Date.now();
			const prebuild = await resolvePrebuild(prebuildResolutionOptions);
			logger.debug(
				{
					orgId: organizationId.slice(0, 8),
					durationMs: Date.now() - prebuildStartMs,
					isNew: prebuild.isNew,
					hasSnapshot: Boolean(prebuild.snapshotId),
					repoCount: prebuild.repoIds.length,
				},
				"sessions.create.prebuild.resolved",
			);

			logger.info(
				{
					prebuildId: prebuild.id.slice(0, 8),
					isNew: prebuild.isNew,
					hasSnapshot: Boolean(prebuild.snapshotId),
				},
				"Prebuild resolved",
			);

			// Create session
			const createSessionStartMs = Date.now();
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
			const createSessionDurationMs = Date.now() - createSessionStartMs;
			logger.debug(
				{
					orgId: organizationId.slice(0, 8),
					sessionId: result.sessionId.slice(0, 8),
					status: result.status,
					durationMs: createSessionDurationMs,
					createdSandbox: Boolean(result.sandbox),
					hasSnapshot: result.hasSnapshot,
				},
				"sessions.create.session.created",
			);
			if (idempotencyKey && createSessionDurationMs > IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS * 1000) {
				logger.warn(
					{
						orgId: organizationId.slice(0, 8),
						sessionId: result.sessionId.slice(0, 8),
						durationMs: createSessionDurationMs,
						inFlightTtlSeconds: IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS,
					},
					"sessions.create.idempotency.in_flight_ttl_risk",
				);
			}

			logger.info(
				{
					sessionId: result.sessionId.slice(0, 8),
					status: result.status,
					hasSandbox: Boolean(result.sandbox),
				},
				"Session created",
			);

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

			logger.debug(
				{
					orgId: organizationId.slice(0, 8),
					sessionId: result.sessionId.slice(0, 8),
					durationMs: Date.now() - requestStartMs,
				},
				"sessions.create.complete",
			);
			res.status(201).json(response);
		} catch (err) {
			if (idempotencyState) {
				await clearIdempotencyKey(idempotencyState.orgId, idempotencyState.key);
			}
			logger.error(
				{
					orgId: idempotencyState?.orgId?.slice(0, 8),
					durationMs: Date.now() - requestStartMs,
					err,
				},
				"sessions.create.error",
			);
			next(err);
		}
	});

	router.get("/:sessionId/status", async (req, res, next) => {
		try {
			const auth = req.auth;
			if (!auth) {
				throw new ApiError(401, "Authentication required");
			}
			// Service auth can use query param; user/CLI auth must have orgId on the token
			const orgId = auth.orgId ?? (req.query.organizationId as string);
			if (!orgId) {
				throw new ApiError(401, "Organization required");
			}

			const sessionId = req.params.sessionId;
			const session = await sessions.getFullSession(sessionId, orgId);
			if (!session) {
				throw new ApiError(404, "Session not found");
			}

			const terminated = session.status === "stopped" || Boolean(session.endedAt);
			const sandboxId = session.sandboxId ?? undefined;

			// Check provider-level sandbox liveness when the session looks running and has a sandbox
			let sandboxAlive: boolean | null | undefined;
			if (!terminated && sandboxId && provider.checkSandboxes) {
				try {
					const alive = await provider.checkSandboxes([sandboxId]);
					sandboxAlive = alive.includes(sandboxId);
				} catch {
					sandboxAlive = null;
				}
			}

			const response: Record<string, unknown> = {
				state: terminated ? "terminated" : "running",
				status: session.status ?? "unknown",
				terminatedAt: session.endedAt?.toISOString(),
				reason: session.stopReason ?? undefined,
				sandboxId,
			};
			if (sandboxAlive !== undefined) {
				response.sandboxAlive = sandboxAlive;
			}
			res.json(response);
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
	// Billing gate — setup sessions are billable like regular sessions
	await billing.assertBillingGateForOrg(organizationId, "session_start");

	// Get repo names for prompt
	const prebuildRepos = await prebuilds.getPrebuildReposWithDetails(prebuildId);

	const repoNames =
		prebuildRepos?.filter((pr) => pr.repo !== null).map((pr) => pr.repo!.githubRepoName) || [];

	const repoNamesStr = repoNames.join(", ") || "workspace";
	const prompt = `Set up ${repoNamesStr} for development. Get everything running and working.`;

	// Create setup session (with atomic concurrent admission guard)
	const sessionId = crypto.randomUUID();
	const setupInput = {
		id: sessionId,
		prebuildId,
		organizationId,
		initialPrompt: prompt,
	};

	const planLimits = await billing.getOrgPlanLimits(organizationId);
	if (planLimits) {
		const { created } = await sessions.createSetupSessionWithAdmissionGuard(
			setupInput,
			planLimits.maxConcurrentSessions,
		);
		if (!created) {
			logger.info(
				{ organizationId, maxConcurrent: planLimits.maxConcurrentSessions },
				"Setup session skipped: concurrent limit reached",
			);
			return;
		}
	} else {
		await sessions.createSetupSession(setupInput);
	}

	// Use HubManager to get/create hub and post prompt directly (fire-and-forget)
	hubManager
		.getOrCreate(sessionId)
		.then((hub) => {
			hub.postPrompt(prompt, "managed-prebuild-setup");
		})
		.catch((err) => {
			logger.error({ err }, "Failed to start setup session");
		});
}
