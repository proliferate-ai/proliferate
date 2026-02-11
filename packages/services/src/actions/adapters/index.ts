/**
 * Action adapter registry.
 *
 * Central registry mapping integration names to their action adapters.
 */

import { linearAdapter } from "./linear";
import { sentryAdapter } from "./sentry";
import type { ActionAdapter, ActionDefinition } from "./types";

const registry = new Map<string, ActionAdapter>();
registry.set("sentry", sentryAdapter);
registry.set("linear", linearAdapter);

export function getAdapter(integration: string): ActionAdapter | undefined {
	return registry.get(integration);
}

export interface AdapterSummary {
	integration: string;
	actions: ActionDefinition[];
}

export function listAdapters(): AdapterSummary[] {
	return Array.from(registry.values()).map((adapter) => ({
		integration: adapter.integration,
		actions: adapter.actions,
	}));
}

/**
 * Get the guide markdown for a specific integration.
 * Returns undefined if the integration doesn't exist or has no guide.
 */
export function getGuide(integration: string): string | undefined {
	return registry.get(integration)?.guide;
}

export type { ActionAdapter, ActionDefinition, ActionParam } from "./types";
