/**
 * Sessions Route
 *
 * POST /proliferate/sessions - Unified session creation endpoint
 */

import { createLogger } from "@proliferate/logger";
import { billing, configurations, sessions } from "@proliferate/services";
import { getSandboxProvider } from "@proliferate/shared/providers";
import type { Router as RouterType } from "express";
import { Router } from "express";
import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";

const logger = createLogger({ service: "gateway" }).child({ module: "sessions-route" });
import {
	type ConfigurationResolutionOptions,
	resolveConfiguration,
} from "../../../lib/configuration-resolver";
import {
	IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS,
	clearIdempotencyKey,
	readIdempotencyResponse,
	reserveIdempotencyKey,
	storeIdempotencyResponse,
} from "../../../lib/idempotency";
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

	// Configuration resolution (exactly one required)
	configurationId?: string;
	managedConfiguration?: { repoIds?: string[] };
	cliConfiguration?: { localPathHash: string; displayName?: string };

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
	configurationId: string;
	status: "pending" | "starting" | "running";
	gatewayUrl: string;
	hasSnapshot: boolean;
	isNewConfiguration: boolean;
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

			// Validate exactly one configuration option is provided
			const configurationOptions = [
				body.configurationId,
				body.managedConfiguration,
				body.cliConfiguration,
			].filter(Boolean);
			if (configurationOptions.length === 0) {
				throw new ApiError(
					400,
					"One of configurationId, managedConfiguration, or cliConfiguration is required",
				);
			}
			if (configurationOptions.length > 1) {
				throw new ApiError(
					400,
					"Only one of configurationId, managedConfiguration, or cliConfiguration can be provided",
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

			// Resolve configuration
			const configurationResolutionOptions: ConfigurationResolutionOptions = {
				organizationId,
				provider,
				userId: auth.userId,
				configurationId: body.configurationId,
				managedConfiguration: body.managedConfiguration,
				cliConfiguration: body.cliConfiguration,
			};

			logger.info({ orgId: organizationId.slice(0, 8) }, "Resolving configuration");

			const configurationStartMs = Date.now();
			const configuration = await resolveConfiguration(configurationResolutionOptions);
			logger.debug(
				{
					orgId: organizationId.slice(0, 8),
					durationMs: Date.now() - configurationStartMs,
					isNew: configuration.isNew,
					hasSnapshot: Boolean(configuration.snapshotId),
					repoCount: configuration.repoIds.length,
				},
				"sessions.create.configuration.resolved",
			);

			logger.info(
				{
					configurationId: configuration.id.slice(0, 8),
					isNew: configuration.isNew,
					hasSnapshot: Boolean(configuration.snapshotId),
				},
				"Configuration resolved",
			);

			// Create session
			const createSessionStartMs = Date.now();
			const result = await createSession(
				{
					env,
					provider,
					organizationId,
					configurationId: configuration.id,
					sessionType: body.sessionType,
					clientType: body.clientType,
					userId: auth.userId,
					snapshotId: body.snapshotId || configuration.snapshotId,
					configurationStatus: configuration.status,
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
								localPathHash: body.cliConfiguration?.localPathHash,
							}
						: undefined,
				},
				configuration.isNew,
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

			// For new managed configurations, kick off setup session
			if (configuration.isNew && body.managedConfiguration) {
				await startSetupSession(configuration.id, organizationId, hubManager);
			}

			const response: CreateSessionResponse = {
				sessionId: result.sessionId,
				configurationId: result.configurationId,
				status: result.status,
				gatewayUrl,
				hasSnapshot: result.hasSnapshot,
				isNewConfiguration: result.isNewConfiguration,
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
 * Start a setup session for a new managed configuration
 */
async function startSetupSession(
	configurationId: string,
	organizationId: string,
	hubManager: HubManager,
): Promise<void> {
	// Billing gate — setup sessions are billable like regular sessions
	await billing.assertBillingGateForOrg(organizationId, "session_start");

	// Get repo names for prompt
	const configurationRepos = await configurations.getConfigurationReposWithDetails(configurationId);

	const repoNames =
		configurationRepos?.filter((pr) => pr.repo !== null).map((pr) => pr.repo!.githubRepoName) || [];

	const repoNamesStr = repoNames.join(", ") || "workspace";
	const prompt = `Set up ${repoNamesStr} for development. Get everything running and working.`;

	// Create setup session (with atomic concurrent admission guard)
	const sessionId = crypto.randomUUID();
	const setupInput = {
		id: sessionId,
		configurationId,
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
			hub.postPrompt(prompt, "managed-configuration-setup");
		})
		.catch((err) => {
			logger.error({ err }, "Failed to start setup session");
		});
}
