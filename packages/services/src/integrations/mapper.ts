/**
 * Integrations mapper.
 *
 * Transforms DB rows (camelCase) to API response types (snake_case).
 */

import type { Integration, IntegrationWithCreator } from "@proliferate/shared";
import { toIsoString } from "../db/serialize";
import type { IntegrationRow, IntegrationWithCreatorRow, UserRow } from "./db";

/**
 * Map a DB row to API Integration type.
 * Converts camelCase DB fields to snake_case API fields.
 */
export function toIntegration(row: IntegrationRow): Integration {
	return {
		id: row.id,
		organization_id: row.organizationId,
		provider: row.provider,
		integration_id: row.integrationId,
		connection_id: row.connectionId,
		display_name: row.displayName,
		status: row.status,
		visibility: row.visibility,
		created_by: row.createdBy,
		created_at: toIsoString(row.createdAt),
		updated_at: toIsoString(row.updatedAt),
	};
}

/**
 * Map a DB row with creator info to API IntegrationWithCreator type.
 */
export function toIntegrationWithCreator(
	row: IntegrationRow,
	creator: UserRow | null,
): IntegrationWithCreator {
	return {
		...toIntegration(row),
		creator: creator
			? {
					id: creator.id,
					name: creator.name,
					email: creator.email,
				}
			: null,
	};
}

/**
 * Map integration with creator relation (from Drizzle with: { createdByUser: true }).
 */
export function toIntegrationWithCreatorRelation(
	row: IntegrationWithCreatorRow,
): IntegrationWithCreator {
	return {
		...toIntegration(row),
		creator: row.createdByUser
			? {
					id: row.createdByUser.id,
					name: row.createdByUser.name,
					email: row.createdByUser.email,
				}
			: null,
	};
}

/**
 * Map multiple DB rows to API Integration types.
 */
export function toIntegrations(rows: IntegrationRow[]): Integration[] {
	return rows.map(toIntegration);
}

/**
 * Attach creator info to integrations.
 */
export function attachCreators(
	integrations: IntegrationRow[],
	users: UserRow[],
): IntegrationWithCreator[] {
	const userMap = new Map(users.map((u) => [u.id, u]));

	return integrations.map((integration) => {
		const creator = integration.createdBy ? userMap.get(integration.createdBy) || null : null;
		return toIntegrationWithCreator(integration, creator);
	});
}

/**
 * Filter integrations by visibility and user.
 */
export function filterByVisibility(
	integrations: IntegrationWithCreator[],
	userId: string,
): IntegrationWithCreator[] {
	return integrations.filter((integration) => {
		// Org-visible or unset visibility is visible to all
		if (integration.visibility === "org" || !integration.visibility) {
			return true;
		}
		// Personal visibility - only visible to creator
		return integration.created_by === userId;
	});
}

/**
 * Group integrations by provider type.
 */
export function groupByProvider(integrations: IntegrationWithCreator[]): {
	github: IntegrationWithCreator[];
	sentry: IntegrationWithCreator[];
	linear: IntegrationWithCreator[];
} {
	return {
		github: integrations.filter((i) => i.integration_id?.includes("github")),
		sentry: integrations.filter((i) => i.integration_id?.includes("sentry")),
		linear: integrations.filter((i) => i.integration_id?.includes("linear")),
	};
}
