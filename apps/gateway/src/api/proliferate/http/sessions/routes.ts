import { createLogger } from "@proliferate/logger";
import { billing, configurations, sessions } from "@proliferate/services";
import { getSandboxProvider } from "@proliferate/shared/providers";
import type { Router as RouterType } from "express";
import { Router } from "express";
import type { HubManager } from "../../../../hub";
import type { GatewayEnv } from "../../../../lib/env";
import {
	IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS,
	clearIdempotencyKey,
	readIdempotencyResponse,
	reserveIdempotencyKey,
	storeIdempotencyResponse,
} from "../../../../lib/idempotency";
import { ApiError } from "../../../../middleware/errors";
import {
	type ConfigurationResolutionOptions,
	resolveConfiguration,
} from "./configuration-resolver";
import { type ClientType, type SessionType, createSession } from "./session-creator";

const logger = createLogger({ service: "gateway" }).child({ module: "sessions-route" });

interface CreateSessionRequest {
	organizationId: string;
	configurationId?: string;
	managedConfiguration?: { repoIds?: string[] };
	sessionType: SessionType;
	clientType: ClientType;
	clientMetadata?: Record<string, unknown>;
	snapshotId?: string;
	initialPrompt?: string;
	title?: string;
	agentConfig?: { modelId?: string };
	automationId?: string;
	triggerId?: string;
	triggerEventId?: string;
	triggerContext?: Record<string, unknown>;
}

interface CreateSessionResponse {
	sessionId: string;
	configurationId: string;
	status: "pending";
	gatewayUrl: string;
	hasSnapshot: boolean;
	isNewConfiguration: boolean;
}

export function createSessionsRoutes(env: GatewayEnv, hubManager: HubManager): RouterType {
	const router: RouterType = Router();
	const provider = getSandboxProvider();
	const gatewayUrl = env.gatewayUrl;

	router.post("/", async (req, res, next) => {
		let idempotencyState: { orgId: string; key: string } | null = null;
		const requestStartMs = Date.now();
		try {
			const auth = req.auth;
			if (!auth) throw new ApiError(401, "Authentication required");

			const body = req.body as CreateSessionRequest;
			const organizationId = auth.orgId ?? body.organizationId;
			if (!organizationId) throw new ApiError(401, "Organization required");
			if (!body.sessionType) throw new ApiError(400, "sessionType is required");
			if (!body.clientType) throw new ApiError(400, "clientType is required");

			const configurationOptions = [body.configurationId, body.managedConfiguration].filter(
				Boolean,
			);
			if (configurationOptions.length === 0) {
				throw new ApiError(400, "One of configurationId or managedConfiguration is required");
			}
			if (configurationOptions.length > 1) {
				throw new ApiError(
					400,
					"Only one of configurationId or managedConfiguration can be provided",
				);
			}

			const idempotencyKey = req.header("Idempotency-Key");
			if (idempotencyKey) {
				const idempotencyStartMs = Date.now();
				const existing = await readIdempotencyResponse(organizationId, idempotencyKey);
				if (existing) {
					logger.debug(
						{ orgId: organizationId.slice(0, 8), durationMs: Date.now() - idempotencyStartMs },
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
						res.status(201).json(replay as CreateSessionResponse);
						return;
					}
				}
				if (reservation === "in_flight") {
					throw new ApiError(409, "Idempotent request already in progress");
				}
				idempotencyState = { orgId: organizationId, key: idempotencyKey };
			}

			const operation = body.automationId ? "automation_trigger" : "session_start";
			await billing.assertBillingGateForOrg(organizationId, operation);

			const configurationResolutionOptions: ConfigurationResolutionOptions = {
				organizationId,
				configurationId: body.configurationId,
				managedConfiguration: body.managedConfiguration ?? undefined,
			};
			const configuration = await resolveConfiguration(configurationResolutionOptions);

			const createSessionStartMs = Date.now();
			const result = await createSession(
				{
					provider,
					organizationId,
					configurationId: configuration.id,
					sessionType: body.sessionType,
					clientType: body.clientType,
					userId: auth.userId,
					snapshotId: body.snapshotId || configuration.snapshotId,
					initialPrompt: body.initialPrompt,
					title: body.title,
					clientMetadata: body.clientMetadata,
					agentConfig: body.agentConfig,
					automationId: body.automationId,
					triggerId: body.triggerId,
					triggerEventId: body.triggerEventId,
				},
				configuration.isNew,
			);
			const createSessionDurationMs = Date.now() - createSessionStartMs;
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
			};

			if (idempotencyState) {
				await storeIdempotencyResponse(idempotencyState.orgId, idempotencyState.key, response);
			}

			res.status(201).json(response);
		} catch (error) {
			if (idempotencyState) {
				await clearIdempotencyKey(idempotencyState.orgId, idempotencyState.key);
			}
			logger.error(
				{
					orgId: idempotencyState?.orgId?.slice(0, 8),
					durationMs: Date.now() - requestStartMs,
					err: error,
				},
				"sessions.create.error",
			);
			next(error);
		}
	});

	router.get("/:sessionId/status", async (req, res, next) => {
		try {
			const auth = req.auth;
			if (!auth) throw new ApiError(401, "Authentication required");
			const orgId = auth.orgId ?? (req.query.organizationId as string);
			if (!orgId) throw new ApiError(401, "Organization required");

			const sessionId = req.params.sessionId;
			const session = await sessions.getFullSession(sessionId, orgId);
			if (!session) throw new ApiError(404, "Session not found");

			const terminated = session.status === "stopped" || Boolean(session.endedAt);
			const sandboxId = session.sandboxId ?? undefined;

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
			if (sandboxAlive !== undefined) response.sandboxAlive = sandboxAlive;
			res.json(response);
		} catch (error) {
			next(error);
		}
	});

	return router;
}

async function startSetupSession(
	configurationId: string,
	organizationId: string,
	hubManager: HubManager,
): Promise<void> {
	await billing.assertBillingGateForOrg(organizationId, "session_start");

	const configurationRepos = await configurations.getConfigurationReposWithDetails(configurationId);
	const repoNames =
		configurationRepos?.filter((pr) => pr.repo !== null).map((pr) => pr.repo!.githubRepoName) || [];

	const repoNamesStr = repoNames.join(", ") || "workspace";
	const prompt = `Set up ${repoNamesStr} for development. Get everything running and working.`;

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

	hubManager
		.getOrCreate(sessionId)
		.then((hub) => hub.postPrompt(prompt, "managed-configuration-setup"))
		.catch((error) => {
			logger.error({ err: error }, "Failed to start setup session");
		});
}
