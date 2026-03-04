/**
 * Session Creator
 *
 * Writes a session DB record and records lifecycle events.
 * Sandbox boot is always deferred — callers trigger eager-start after creation.
 */

import { createLogger } from "@proliferate/logger";
import { automations, billing, sessions } from "@proliferate/services";
import type { SandboxProvider } from "@proliferate/shared";

const logger = createLogger({ service: "gateway" }).child({ module: "session-creator" });

export type SessionType = "coding" | "setup";
export type ClientType = "web" | "slack" | "automation";

export interface CreateSessionOptions {
	provider: SandboxProvider;

	// Required
	organizationId: string;
	configurationId: string;
	sessionType: SessionType;
	clientType: ClientType;

	// Optional
	userId?: string;
	snapshotId?: string | null;
	initialPrompt?: string;
	title?: string;
	clientMetadata?: Record<string, unknown>;
	agentConfig?: { modelId?: string };
	automationId?: string;
	triggerId?: string;
	triggerEventId?: string;

	/** Explicit integration IDs for OAuth token injection.
	 * If not provided, will inherit from automationId's connections. */
	integrationIds?: string[];
}

export interface CreateSessionResult {
	sessionId: string;
	configurationId: string;
	status: "pending";
	hasSnapshot: boolean;
	isNewConfiguration: boolean;
}

/**
 * Create a new session
 */
export async function createSession(
	options: CreateSessionOptions,
	isNewConfiguration = false,
): Promise<CreateSessionResult> {
	const {
		provider,
		organizationId,
		configurationId,
		sessionType,
		clientType,
		userId,
		snapshotId: inputSnapshotId,
		initialPrompt,
		title,
		clientMetadata,
		agentConfig,
		automationId,
		triggerId,
		triggerEventId,
		integrationIds: explicitIntegrationIds = [],
	} = options;

	const sessionId = crypto.randomUUID();
	const startMs = Date.now();
	const log = logger.child({ sessionId });

	log.info(
		{
			sessionType,
			clientType,
			hasSnapshot: Boolean(inputSnapshotId),
			explicitIntegrations: explicitIntegrationIds?.length ?? 0,
		},
		"Creating session",
	);

	// Resolve integration IDs (explicit or inherited from automation)
	let resolvedIntegrationIds: string[] = explicitIntegrationIds;
	if (!resolvedIntegrationIds.length && automationId) {
		try {
			const automationConnections =
				await automations.listAutomationConnectionsInternal(automationId);
			resolvedIntegrationIds = automationConnections
				.filter((c) => c.integration?.status === "active")
				.map((c) => c.integrationId);
		} catch (err) {
			log.warn({ err }, "Failed to load automation connections");
		}
	}

	const snapshotId = inputSnapshotId ?? null;
	const visibility: "private" | "org" =
		sessionType === "setup" ? "org" : clientType === "automation" ? "org" : "private";
	const kind: "task" | "setup" = sessionType === "setup" ? "setup" : "task";

	// Write session record (atomic admission guard when plan limits apply)
	try {
		const sessionInput = {
			id: sessionId,
			configurationId,
			organizationId,
			sessionType,
			clientType,
			status: "pending",
			sandboxProvider: provider.type,
			createdBy: userId,
			snapshotId,
			initialPrompt,
			title,
			clientMetadata,
			agentConfig,
			automationId,
			triggerId,
			triggerEventId,
			visibility,
			kind,
		};

		const planLimits = await billing.getOrgPlanLimits(organizationId);
		if (planLimits) {
			const { created } = await sessions.createWithAdmissionGuard(
				sessionInput,
				planLimits.maxConcurrentSessions,
			);
			if (!created) {
				throw new Error(
					`Concurrent session limit reached. Your plan allows ${planLimits.maxConcurrentSessions} concurrent session${planLimits.maxConcurrentSessions === 1 ? "" : "s"}.`,
				);
			}
		} else {
			await sessions.create(sessionInput);
		}
	} catch (err) {
		log.error({ err }, "Failed to create session");
		throw new Error(
			`Failed to create session: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Record integration connections
	if (resolvedIntegrationIds.length > 0) {
		try {
			await sessions.createSessionConnections(sessionId, resolvedIntegrationIds);
			log.info({ connectionCount: resolvedIntegrationIds.length }, "Recorded session connections");
		} catch (err) {
			log.warn({ err }, "Failed to record session connections");
		}
	}

	// K5: Record session_created lifecycle event (best-effort)
	try {
		await sessions.recordSessionEvent({ sessionId, eventType: "session_created" });
	} catch (err) {
		log.warn({ err }, "Failed to record session_created event");
	}

	log.info({ durationMs: Date.now() - startMs }, "session_creator.create_session.complete");
	return {
		sessionId,
		configurationId,
		status: "pending",
		hasSnapshot: Boolean(snapshotId),
		isNewConfiguration,
	};
}
