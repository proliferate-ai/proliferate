/**
 * Mode resolution DB helpers.
 *
 * Reads and writes the action_modes JSONB columns on
 * organizations and automations tables.
 */

import type { ActionMode } from "@proliferate/providers";
import { automations, eq, getDb, organization } from "../db/client";

type ActionModesMap = Record<string, string>;

const VALID_ACTION_MODES = new Set<string>(["allow", "deny", "require_approval"]);

/**
 * Read org-level action mode overrides.
 * Returns a map of "sourceId:actionId" → "allow" | "deny" | "require_approval".
 */
export async function getOrgActionModes(orgId: string): Promise<ActionModesMap> {
	const db = getDb();
	const [row] = await db
		.select({ actionModes: organization.actionModes })
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);
	return (row?.actionModes as ActionModesMap) ?? {};
}

/**
 * Read automation-level action mode overrides.
 */
export async function getAutomationActionModes(automationId: string): Promise<ActionModesMap> {
	const db = getDb();
	const [row] = await db
		.select({ actionModes: automations.actionModes })
		.from(automations)
		.where(eq(automations.id, automationId))
		.limit(1);
	return (row?.actionModes as ActionModesMap) ?? {};
}

/**
 * Set a single org-level action mode override.
 * Used by the "always approve" flow.
 */
export async function setOrgActionMode(orgId: string, key: string, mode: ActionMode): Promise<void> {
	if (!VALID_ACTION_MODES.has(mode)) {
		throw new Error(`Invalid action mode: ${mode}`);
	}
	const db = getDb();
	const existing = await getOrgActionModes(orgId);
	existing[key] = mode;
	await db.update(organization).set({ actionModes: existing }).where(eq(organization.id, orgId));
}

/**
 * Set a single automation-level action mode override.
 */
export async function setAutomationActionMode(
	automationId: string,
	key: string,
	mode: ActionMode,
): Promise<void> {
	if (!VALID_ACTION_MODES.has(mode)) {
		throw new Error(`Invalid action mode: ${mode}`);
	}
	const db = getDb();
	const existing = await getAutomationActionModes(automationId);
	existing[key] = mode;
	await db
		.update(automations)
		.set({ actionModes: existing })
		.where(eq(automations.id, automationId));
}
