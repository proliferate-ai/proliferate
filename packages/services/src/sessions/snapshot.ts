/**
 * Session snapshot service.
 *
 * Creates a snapshot of the session's current state.
 */

import type { SandboxProviderType } from "@proliferate/shared";
import type { BillingPlan } from "@proliferate/shared/billing";
import { getSandboxProvider } from "@proliferate/shared/providers";
import * as billing from "../billing";
import { prepareForSnapshot } from "../lib/snapshot-scrub";
import { getServicesLogger } from "../logger";
import * as orgs from "../orgs";
import { SessionInvalidStateError, SessionNotFoundError } from "./pause";
import { getFullSession, updateSession } from "./service";

export interface SnapshotSessionInput {
	sessionId: string;
	orgId: string;
}

export interface SnapshotSessionResult {
	snapshot_id: string;
}

export class SessionSnapshotQuotaError extends Error {
	constructor() {
		super("Snapshot quota exceeded. Delete an existing snapshot and try again.");
		this.name = "SessionSnapshotQuotaError";
	}
}

export async function snapshotSession(input: SnapshotSessionInput): Promise<SnapshotSessionResult> {
	const { sessionId, orgId } = input;
	const log = getServicesLogger().child({ module: "sessions/snapshot", sessionId });

	const session = await getFullSession(sessionId, orgId);

	if (!session) {
		throw new SessionNotFoundError(sessionId);
	}

	if (!session.sandboxId) {
		throw new SessionInvalidStateError("Session has no sandbox");
	}

	const org = await orgs.getBillingInfoV2(orgId);
	const plan: BillingPlan = org?.billingPlan === "pro" ? "pro" : "dev";

	const capacity = await billing.ensureSnapshotCapacity(
		orgId,
		plan,
		billing.deleteSnapshotFromProvider,
	);
	if (!capacity.allowed) {
		throw new SessionSnapshotQuotaError();
	}

	const startTime = Date.now();
	log.info("Snapshot started");

	const providerType = session.sandboxProvider as SandboxProviderType | undefined;
	const provider = getSandboxProvider(providerType);
	const finalizeSnapshotPrep = await prepareForSnapshot({
		provider,
		sandboxId: session.sandboxId,
		configurationId: session.configurationId ?? null,
		logger: log,
		logContext: "web_manual_snapshot",
		failureMode: "throw",
		reapplyAfterCapture: true,
	});
	try {
		const result = await provider.snapshot(sessionId, session.sandboxId);
		const providerMs = Date.now() - startTime;
		log.info({ providerMs, providerType: provider.type }, "Provider snapshot complete");

		await updateSession(sessionId, { snapshotId: result.snapshotId });
		log.info({ totalMs: Date.now() - startTime, providerMs }, "Snapshot complete");

		return { snapshot_id: result.snapshotId };
	} finally {
		await finalizeSnapshotPrep();
	}
}
