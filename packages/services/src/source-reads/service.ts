/**
 * Source reads service.
 *
 * Resolves credentials server-side and dispatches to provider normalizers.
 * The manager harness never receives raw credentials.
 *
 * Credential resolution precedence (per spec 03):
 * 1. Worker-configured credential owner (binding.credentialOwnerId)
 * 2. Org-level integration credential
 * 3. Fail with CREDENTIAL_MISSING
 */

import * as integrationsDb from "../integrations/db";
import { getToken } from "../integrations/tokens";
import { getServicesLogger } from "../logger";
import * as sourceDb from "./db";
import type { SourceBindingRow } from "./db";
import {
	type NormalizedSourceItem,
	type SourceQueryResult,
	type SourceType,
	getNormalizer,
} from "./normalizers";

// ============================================
// Error Classes
// ============================================

export class CredentialMissingError extends Error {
	readonly code = "CREDENTIAL_MISSING";

	constructor(sourceType: string, bindingId: string) {
		super(`No credential available for source ${sourceType} (binding: ${bindingId})`);
	}
}

export class IntegrationRevokedError extends Error {
	readonly code = "INTEGRATION_REVOKED";

	constructor(integrationId: string) {
		super(`Integration ${integrationId} is not active`);
	}
}

export class SourceTypeUnsupportedError extends Error {
	readonly code = "SOURCE_TYPE_UNSUPPORTED";

	constructor(sourceType: string) {
		super(`Unsupported source type: ${sourceType}`);
	}
}

export class BindingNotFoundError extends Error {
	readonly code = "BINDING_NOT_FOUND";

	constructor(bindingId: string) {
		super(`Source binding not found: ${bindingId}`);
	}
}

// ============================================
// Public Types
// ============================================

export interface SourceBinding {
	bindingId: string;
	sourceType: SourceType;
	sourceRef: string;
	label: string | null;
	lastPolledAt: Date | null;
}

// ============================================
// Credential Resolution
// ============================================

/**
 * Resolve an OAuth token for a source binding.
 *
 * Precedence:
 * 1. credentialOwnerId on the binding → find that user's integration
 * 2. Any org-level active integration for the source type
 * 3. Throw CREDENTIAL_MISSING
 */
async function resolveCredential(binding: SourceBindingRow): Promise<string> {
	const log = getServicesLogger().child({ module: "source-reads", bindingId: binding.id });

	// Map source type to integration type ID (e.g., "sentry" → "sentry")
	const integrationTypeId = binding.sourceType;

	// Find active integrations for this org and type
	const orgIntegrations = await integrationsDb.listAllByOrganization(binding.organizationId);
	const matchingIntegrations = orgIntegrations.filter(
		(i) => i.integrationId === integrationTypeId && i.status === "active",
	);

	if (binding.credentialOwnerId) {
		// Precedence 1: worker-configured credential owner
		const owned = matchingIntegrations.find((i) => i.createdBy === binding.credentialOwnerId);
		if (owned) {
			try {
				return await getToken({
					id: owned.id,
					provider: owned.provider,
					integrationId: owned.integrationId,
					connectionId: owned.connectionId,
					githubInstallationId: owned.githubInstallationId,
				});
			} catch (err) {
				log.warn(
					{ err, integrationId: owned.id },
					"Failed to resolve credential owner token, falling through",
				);
			}
		}
	}

	// Precedence 2: any org-level integration
	for (const integration of matchingIntegrations) {
		try {
			return await getToken({
				id: integration.id,
				provider: integration.provider,
				integrationId: integration.integrationId,
				connectionId: integration.connectionId,
				githubInstallationId: integration.githubInstallationId,
			});
		} catch (err) {
			log.warn({ err, integrationId: integration.id }, "Failed to resolve org integration token");
		}
	}

	// For GitHub, also check github-app integrations
	if (integrationTypeId === "github") {
		const ghAppIntegrations = orgIntegrations.filter(
			(i) => i.provider === "github-app" && i.status === "active",
		);
		for (const integration of ghAppIntegrations) {
			try {
				return await getToken({
					id: integration.id,
					provider: integration.provider,
					integrationId: integration.integrationId,
					connectionId: integration.connectionId,
					githubInstallationId: integration.githubInstallationId,
				});
			} catch (err) {
				log.warn({ err, integrationId: integration.id }, "Failed to resolve GitHub App token");
			}
		}
	}

	// Precedence 3: fail
	throw new CredentialMissingError(binding.sourceType, binding.id);
}

// ============================================
// Service Functions
// ============================================

export async function listBindings(
	workerId: string,
	organizationId: string,
): Promise<SourceBinding[]> {
	const bindings = await sourceDb.listBindingsByWorker(workerId, organizationId);

	// Batch-fetch cursors for lastPolledAt
	const bindingsWithCursors: SourceBinding[] = [];
	for (const binding of bindings) {
		const cursor = await sourceDb.findCursorByBinding(binding.id);
		bindingsWithCursors.push({
			bindingId: binding.id,
			sourceType: binding.sourceType as SourceType,
			sourceRef: binding.sourceRef,
			label: binding.label,
			lastPolledAt: cursor?.lastPolledAt ?? null,
		});
	}

	return bindingsWithCursors;
}

export async function querySource(
	bindingId: string,
	organizationId: string,
	cursor?: string,
	limit?: number,
): Promise<SourceQueryResult> {
	const binding = await sourceDb.findBindingById(bindingId, organizationId);
	if (!binding) {
		throw new BindingNotFoundError(bindingId);
	}

	const normalizer = getNormalizer(binding.sourceType as SourceType);
	if (!normalizer) {
		throw new SourceTypeUnsupportedError(binding.sourceType);
	}

	const token = await resolveCredential(binding);
	const result = await normalizer.query(token, binding.sourceRef, cursor, limit);

	// Update cursor after successful query
	if (result.cursor || result.items.length > 0) {
		await sourceDb.upsertCursor(bindingId, result.cursor);
	}

	return result;
}

export async function getSourceItem(
	bindingId: string,
	organizationId: string,
	itemRef: string,
): Promise<NormalizedSourceItem | null> {
	const binding = await sourceDb.findBindingById(bindingId, organizationId);
	if (!binding) {
		throw new BindingNotFoundError(bindingId);
	}

	const normalizer = getNormalizer(binding.sourceType as SourceType);
	if (!normalizer) {
		throw new SourceTypeUnsupportedError(binding.sourceType);
	}

	const token = await resolveCredential(binding);
	return normalizer.getItem(token, binding.sourceRef, itemRef);
}
