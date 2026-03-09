/**
 * Workers service.
 *
 * Business rules around worker lifecycle, wake/run orchestration, and run events.
 */

import { createSyncClient } from "@proliferate/gateway-clients";
import type { CapabilityMode } from "@proliferate/shared/contracts/actions";
import type { CoworkerCapabilityInput } from "@proliferate/shared/contracts/automations";
import { type WorkerStatus, isValidWorkerTransition } from "@proliferate/shared/contracts/workers";
import {
	TemplateIntegrationBindingMismatchError,
	TemplateIntegrationInactiveError,
	TemplateIntegrationNotFoundError,
	TemplateNotFoundError,
} from "../automations/errors";
import { findForBindingValidation } from "../integrations/service";
import { getServicesLogger } from "../logger";
import * as sessionsDb from "../sessions/db";
import { getTemplateById } from "../templates/catalog";
import type { WakeEventRow } from "../wakes/db";
import * as wakesDb from "../wakes/db";
import type { WorkerRow, WorkerRunEventRow } from "./db";
import * as workersDb from "./db";
import {
	WorkerNotActiveError,
	WorkerNotFoundError,
	WorkerResumeRequiredError,
	WorkerStatusTransitionError,
} from "./errors";

export {
	WorkerNotActiveError,
	WorkerNotFoundError,
	WorkerResumeRequiredError,
	WorkerRunEventTypeError,
	WorkerRunNotFoundError,
	WorkerRunTransitionError,
	WorkerStatusTransitionError,
} from "./errors";

const logger = getServicesLogger().child({ module: "workers" });

export interface RunNowResult {
	status: "queued";
	wakeEvent: WakeEventRow;
}

export interface RunWorkerNowInput {
	workerId: string;
	organizationId: string;
	gatewayUrl?: string | null;
	serviceToken?: string | null;
	payloadJson?: unknown;
}

export interface WorkerDetail {
	id: string;
	name: string;
	description: string | null;
	status: string;
	systemPrompt: string | null;
	modelId: string | null;
	managerSessionId: string;
	lastErrorCode: string | null;
	pausedAt: Date | null;
	createdBy: string | null;
	computeProfile: string | null;
	pausedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface WorkerListEntry extends WorkerDetail {
	activeTaskCount: number;
	pendingApprovalCount: number;
}

export interface WorkerRunListItem {
	id: string;
	workerId: string;
	status: string;
	summary: string | null;
	wakeEventId: string;
	createdAt: Date;
	startedAt: Date | null;
	completedAt: Date | null;
	events: Array<{
		id: string;
		eventIndex: number;
		eventType: string;
		summaryText: string | null;
		payloadJson: unknown;
		sessionId: string | null;
		actionInvocationId: string | null;
		createdAt: Date;
	}>;
}

export interface WorkerSessionListItem {
	id: string;
	title: string | null;
	status: string | null;
	repoId: string | null;
	branchName: string | null;
	operatorStatus: string;
	updatedAt: Date | null;
	startedAt: Date | null;
}

export interface PendingDirectiveItem {
	id: string;
	messageType: string;
	payloadJson: unknown;
	queuedAt: Date;
	senderUserId: string | null;
}

export interface WorkerCapability {
	capabilityKey: string;
	mode: CapabilityMode;
	origin: string | null;
}

export interface CreateWorkerFromTemplateInput {
	organizationId: string;
	createdBy: string;
	templateId: string;
	integrationBindings: Record<string, string>;
}

function normalizeWorkerCapabilities(
	capabilities: CoworkerCapabilityInput[] | undefined,
): CoworkerCapabilityInput[] {
	if (!capabilities || capabilities.length === 0) {
		return [];
	}

	const deduped = new Map<string, CoworkerCapabilityInput>();
	for (const capability of capabilities) {
		deduped.set(capability.capabilityKey, capability);
	}
	return [...deduped.values()];
}

async function applyWorkerCapabilities(
	managerSessionId: string,
	capabilities: CoworkerCapabilityInput[] | undefined,
): Promise<void> {
	const normalized = normalizeWorkerCapabilities(capabilities);
	if (normalized.length === 0) {
		return;
	}

	await Promise.all(
		normalized.map((capability) =>
			sessionsDb.upsertSessionCapability({
				sessionId: managerSessionId,
				capabilityKey: capability.capabilityKey,
				mode: capability.mode,
				origin: capability.origin ?? "coworker-settings",
			}),
		),
	);
}

function toWorkerDetail(worker: WorkerRow): WorkerDetail {
	return {
		id: worker.id,
		name: worker.name,
		description: worker.description,
		status: worker.status,
		systemPrompt: worker.systemPrompt,
		modelId: worker.modelId,
		managerSessionId: worker.managerSessionId,
		lastErrorCode: worker.lastErrorCode,
		pausedAt: worker.pausedAt,
		createdBy: worker.createdBy,
		computeProfile: worker.computeProfile,
		pausedBy: worker.pausedBy,
		createdAt: worker.createdAt,
		updatedAt: worker.updatedAt,
	};
}

function toWorkerWithCounts(worker: workersDb.WorkerRowWithCounts): WorkerListEntry {
	return {
		id: worker.id,
		name: worker.name,
		description: worker.description,
		status: worker.status,
		systemPrompt: worker.systemPrompt,
		modelId: worker.modelId,
		managerSessionId: worker.managerSessionId,
		lastErrorCode: worker.lastErrorCode,
		pausedAt: worker.pausedAt,
		createdBy: worker.createdBy,
		computeProfile: worker.computeProfile,
		pausedBy: worker.pausedBy,
		createdAt: worker.createdAt,
		updatedAt: worker.updatedAt,
		activeTaskCount: worker.activeTaskCount,
		pendingApprovalCount: worker.pendingApprovalCount,
	};
}

export async function createWorkerWithManagerSession(input: {
	organizationId: string;
	createdBy: string;
	name?: string;
	description?: string;
	systemPrompt?: string;
	modelId?: string;
	repoId?: string;
	configurationId?: string;
	capabilities?: CoworkerCapabilityInput[];
	integrationIds?: string[];
}): Promise<WorkerDetail> {
	const name = input.name || "Untitled coworker";

	const worker = await workersDb.withTransaction(async (tx) => {
		const placeholderSession = await sessionsDb.createManagerSessionPlaceholder(
			{
				organizationId: input.organizationId,
				createdBy: input.createdBy,
				repoId: input.repoId,
				configurationId: input.configurationId,
				visibility: "org",
				title: `Manager: ${name}`,
			},
			tx,
		);

		const createdWorker = await workersDb.createWorker(
			{
				organizationId: input.organizationId,
				name,
				description: input.description,
				systemPrompt: input.systemPrompt,
				managerSessionId: placeholderSession.id,
				modelId: input.modelId,
				createdBy: input.createdBy,
			},
			tx,
		);

		await sessionsDb.promoteToManagerSession(placeholderSession.id, createdWorker.id, tx);
		return createdWorker;
	});

	await applyWorkerCapabilities(worker.managerSessionId, input.capabilities);
	await applyWorkerIntegrationBindings(worker.managerSessionId, input.integrationIds);

	return toWorkerDetail(worker);
}

export async function createWorkerFromTemplate(
	input: CreateWorkerFromTemplateInput,
): Promise<WorkerDetail> {
	const template = getTemplateById(input.templateId);
	if (!template) {
		throw new TemplateNotFoundError(input.templateId);
	}

	await validateIntegrationBindings(input.organizationId, input.integrationBindings);

	return createWorkerWithManagerSession({
		organizationId: input.organizationId,
		createdBy: input.createdBy,
		name: template.name,
		systemPrompt: template.agentInstructions,
		modelId: template.modelId,
		integrationIds: Object.values(input.integrationBindings).filter(Boolean),
	});
}

async function applyWorkerIntegrationBindings(
	managerSessionId: string,
	integrationIds: string[] | undefined,
): Promise<void> {
	if (!integrationIds || integrationIds.length === 0) {
		return;
	}
	const dedupedIntegrationIds = [...new Set(integrationIds)];
	await sessionsDb.createSessionConnections(managerSessionId, dedupedIntegrationIds);
}

async function validateIntegrationBindings(
	orgId: string,
	bindings: Record<string, string>,
): Promise<void> {
	for (const [bindingKey, integrationId] of Object.entries(bindings)) {
		if (!integrationId) continue;

		const integration = await findForBindingValidation(integrationId, orgId);
		if (!integration) {
			throw new TemplateIntegrationNotFoundError(integrationId);
		}

		if (integration.status !== "active") {
			throw new TemplateIntegrationInactiveError(integrationId, integration.status);
		}

		if (integration.integrationId !== bindingKey) {
			throw new TemplateIntegrationBindingMismatchError(
				integrationId,
				integration.integrationId,
				bindingKey,
			);
		}
	}
}

export async function listWorkersForOrg(orgId: string): Promise<WorkerListEntry[]> {
	const workers = await workersDb.listWorkersByOrgWithCounts(orgId);
	return workers.map((worker) => toWorkerWithCounts(worker));
}

export async function getWorkerForOrgWithCounts(
	workerId: string,
	orgId: string,
): Promise<WorkerListEntry> {
	const workers = await listWorkersForOrg(orgId);
	const worker = workers.find((entry) => entry.id === workerId);
	if (!worker) {
		throw new WorkerNotFoundError(workerId);
	}
	return worker;
}

export async function getWorkerForOrg(
	workerId: string,
	organizationId: string,
): Promise<WorkerRow> {
	const worker = await workersDb.findWorkerById(workerId, organizationId);
	if (!worker) {
		throw new WorkerNotFoundError(workerId);
	}
	return worker;
}

export async function listWorkerCapabilitiesForOrg(
	workerId: string,
	organizationId: string,
): Promise<WorkerCapability[]> {
	const worker = await getWorkerForOrg(workerId, organizationId);
	const capabilities = await sessionsDb.listSessionCapabilities(worker.managerSessionId);
	return capabilities.map((capability) => ({
		capabilityKey: capability.capabilityKey,
		mode: capability.mode as CapabilityMode,
		origin: capability.origin,
	}));
}

/**
 * Service-owned compatibility wrapper for optional worker lookups.
 * Prefer getWorkerForOrg() for strict existence checks.
 */
export async function findWorkerById(
	workerId: string,
	organizationId: string,
): Promise<WorkerRow | undefined> {
	return workersDb.findWorkerById(workerId, organizationId);
}

/**
 * Service-owned wrapper used by tick scheduling and sweeps.
 */
export async function listActiveWorkers(): Promise<WorkerRow[]> {
	return workersDb.listActiveWorkers();
}

/** @deprecated V1 wake-cycle function — will be removed after Coworker V2 migration */
export async function listWorkerRunsForOrg(
	workerId: string,
	organizationId: string,
	limit?: number,
): Promise<WorkerRunListItem[]> {
	await getWorkerForOrg(workerId, organizationId);
	const runs = await workersDb.listRunsByWorkerWithEvents(workerId, limit);
	return runs.map((run) => ({
		id: run.id,
		workerId: run.workerId,
		status: run.status,
		summary: run.summary,
		wakeEventId: run.wakeEventId,
		createdAt: run.createdAt,
		startedAt: run.startedAt,
		completedAt: run.completedAt,
		events: run.events.map((event) => ({
			id: event.id,
			eventIndex: event.eventIndex,
			eventType: event.eventType,
			summaryText: event.summaryText,
			payloadJson: event.payloadJson,
			sessionId: event.sessionId,
			actionInvocationId: event.actionInvocationId,
			createdAt: event.createdAt,
		})),
	}));
}

export async function listWorkerSessionsForOrg(
	workerId: string,
	organizationId: string,
	limit?: number,
): Promise<WorkerSessionListItem[]> {
	await getWorkerForOrg(workerId, organizationId);
	const sessions = await workersDb.listSessionsByWorker(workerId, organizationId, limit);
	return sessions.map((session) => ({
		id: session.id,
		title: session.title,
		status: session.status,
		repoId: session.repoId,
		branchName: session.branchName,
		operatorStatus: session.operatorStatus,
		updatedAt: session.lastActivityAt,
		startedAt: session.startedAt,
	}));
}

/** @deprecated V1 wake-cycle function — will be removed after Coworker V2 migration */
export async function listPendingDirectivesForOrg(
	workerId: string,
	organizationId: string,
): Promise<PendingDirectiveItem[]> {
	const worker = await getWorkerForOrg(workerId, organizationId);
	const messages = await workersDb.listPendingDirectives(worker.managerSessionId);
	return messages.map((message) => ({
		id: message.id,
		messageType: message.messageType,
		payloadJson: message.payloadJson,
		queuedAt: message.queuedAt,
		senderUserId: message.senderUserId,
	}));
}

/**
 * @deprecated V1 wake-cycle function — will be removed after Coworker V2 migration
 * Service-owned wrapper for manager-session directive queue reads.
 */
export async function listPendingDirectives(
	managerSessionId: string,
): Promise<PendingDirectiveItem[]> {
	const messages = await workersDb.listPendingDirectives(managerSessionId);
	return messages.map((message) => ({
		id: message.id,
		messageType: message.messageType,
		payloadJson: message.payloadJson,
		queuedAt: message.queuedAt,
		senderUserId: message.senderUserId,
	}));
}

/** @deprecated V1 wake-cycle function — will be removed after Coworker V2 migration */
export async function sendDirectiveToWorker(input: {
	workerId: string;
	organizationId: string;
	senderUserId: string;
	content: string;
	gatewayUrl?: string;
	serviceToken?: string;
}): Promise<{ messageId: string }> {
	const worker = await getWorkerForOrg(input.workerId, input.organizationId);
	const { messageId } = await sendDirective({
		managerSessionId: worker.managerSessionId,
		content: input.content,
		senderUserId: input.senderUserId,
	});

	if (worker.status === "active") {
		try {
			await wakesDb.createWakeEvent({
				workerId: worker.id,
				organizationId: input.organizationId,
				source: "manual_message",
				payloadJson: { messageId },
			});
		} catch {
			// Best effort: directive remains queued even if wake creation fails.
		}

		// Notify gateway to process the directive immediately
		if (input.gatewayUrl && input.serviceToken) {
			eagerStartManagerSession(worker.managerSessionId, input.gatewayUrl, input.serviceToken);
		}
	}

	return { messageId };
}

export async function pauseWorkerForOrg(
	workerId: string,
	organizationId: string,
	pausedBy?: string | null,
): Promise<WorkerDetail> {
	const worker = await pauseWorker(workerId, organizationId, pausedBy);
	return toWorkerDetail(worker);
}

export async function resumeWorkerForOrg(
	workerId: string,
	organizationId: string,
): Promise<WorkerDetail> {
	const worker = await resumeWorker(workerId, organizationId);
	return toWorkerDetail(worker);
}

export async function updateWorkerForOrg(input: {
	workerId: string;
	organizationId: string;
	fields: {
		name?: string;
		description?: string;
		systemPrompt?: string;
		modelId?: string;
	};
	repoId?: string | null;
	configurationId?: string | null;
	capabilities?: CoworkerCapabilityInput[];
}): Promise<WorkerDetail | null> {
	const updated = await workersDb.updateWorker(input.workerId, input.organizationId, input.fields);
	if (!updated) {
		return null;
	}

	if (input.repoId !== undefined || input.configurationId !== undefined) {
		await sessionsDb.updateManagerSessionLinkage(updated.managerSessionId, input.organizationId, {
			repoId: input.repoId ?? null,
			configurationId: input.configurationId ?? null,
		});
	}
	await applyWorkerCapabilities(updated.managerSessionId, input.capabilities);

	return toWorkerDetail(updated);
}

/**
 * Service-owned wrapper for worker deletion.
 */
export async function deleteWorker(id: string, orgId: string): Promise<boolean> {
	return workersDb.deleteWorker(id, orgId);
}

async function transitionWorker(
	workerId: string,
	organizationId: string,
	toStatus: WorkerStatus,
	idempotentFrom: WorkerStatus,
	fields?: { pausedAt?: Date | null; pausedBy?: string | null },
): Promise<WorkerRow> {
	const worker = await workersDb.findWorkerById(workerId, organizationId);
	if (!worker) throw new WorkerNotFoundError(workerId);

	if (worker.status === idempotentFrom) return worker;

	if (!isValidWorkerTransition(worker.status, toStatus)) {
		throw new WorkerStatusTransitionError(worker.status, toStatus);
	}

	const updated = await workersDb.transitionWorkerStatus(
		worker.id,
		organizationId,
		[worker.status],
		toStatus,
		fields,
	);
	if (!updated) {
		throw new Error(`Worker ${toStatus} failed due to concurrent state change`);
	}
	return updated;
}

export async function pauseWorker(
	workerId: string,
	organizationId: string,
	pausedBy?: string | null,
): Promise<WorkerRow> {
	return transitionWorker(workerId, organizationId, "automations_paused", "automations_paused", {
		pausedAt: new Date(),
		pausedBy: pausedBy ?? null,
	});
}

export async function resumeWorker(workerId: string, organizationId: string): Promise<WorkerRow> {
	return transitionWorker(workerId, organizationId, "active", "active", {
		pausedAt: null,
		pausedBy: null,
	});
}

export async function runNow(
	workerId: string,
	organizationId: string,
	payloadJson?: unknown,
): Promise<RunNowResult> {
	const worker = await workersDb.findWorkerById(workerId, organizationId);
	if (!worker) {
		throw new WorkerNotFoundError(workerId);
	}

	const status = worker.status;
	if (status === "automations_paused") {
		throw new WorkerResumeRequiredError(workerId);
	}
	if (status !== "active") {
		throw new WorkerNotActiveError(workerId, status);
	}

	const wakeEvent = await wakesDb.createWakeEvent({
		workerId,
		organizationId,
		source: "manual",
		payloadJson: payloadJson ?? null,
	});

	return {
		status: "queued",
		wakeEvent,
	};
}

/**
 * Queue a manual wake and best-effort eager-start the worker manager session.
 */
export async function runWorkerNow(input: RunWorkerNowInput): Promise<{ wakeEventId: string }> {
	const result = await runNow(input.workerId, input.organizationId, input.payloadJson);
	const worker = await findWorkerById(input.workerId, input.organizationId);
	if (worker && input.gatewayUrl && input.serviceToken) {
		eagerStartManagerSession(worker.managerSessionId, input.gatewayUrl, input.serviceToken);
	}
	return { wakeEventId: result.wakeEvent.id };
}

function eagerStartManagerSession(
	sessionId: string,
	gatewayUrl: string,
	serviceToken: string,
): void {
	const gateway = createSyncClient({
		baseUrl: gatewayUrl,
		auth: {
			type: "service",
			name: "web-run-worker",
			secret: serviceToken,
		},
	});

	gateway.eagerStart(sessionId).catch((err: unknown) => {
		logger.warn({ err, sessionId }, "Worker eager start request failed");
	});
}

export async function listWorkerRunEvents(workerRunId: string): Promise<WorkerRunEventRow[]> {
	return workersDb.listEventsByRun(workerRunId);
}

export async function sendDirective(input: {
	managerSessionId: string;
	content: string;
	senderUserId: string;
}): Promise<{ messageId: string }> {
	const message = await sessionsDb.enqueueSessionMessage({
		sessionId: input.managerSessionId,
		direction: "user_to_manager",
		messageType: "directive",
		payloadJson: { content: input.content },
		senderUserId: input.senderUserId,
	});
	return { messageId: message.id };
}
