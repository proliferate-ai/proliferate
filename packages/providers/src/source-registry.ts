/**
 * Adapter source registry — maps integration IDs to AdapterActionSource instances.
 *
 * The gateway uses this to discover and execute actions from static adapters
 * (Linear, Sentry, Slack) via the unified ActionSource abstraction.
 */

import type { AdapterActionSource } from "./action-source";
import { linearSource } from "./providers/linear";
import { sentrySource } from "./providers/sentry";
import { slackSource } from "./providers/slack";

const registry = new Map<string, AdapterActionSource>();

registry.set(linearSource.integration, linearSource);
registry.set(sentrySource.integration, sentrySource);
registry.set(slackSource.integration, slackSource);

export function getAdapterSource(integration: string): AdapterActionSource | undefined {
	return registry.get(integration);
}

export function listAdapterSources(): AdapterActionSource[] {
	return Array.from(registry.values());
}
