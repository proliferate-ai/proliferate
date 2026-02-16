/**
 * Provider Action Registry.
 *
 * Central registry mapping provider IDs to their action modules.
 * All registered providers must be stateless — they receive tokens
 * via ActionExecutionContext and never access DB or OAuth brokers directly.
 */

import type { ActionDefinition, ActionExecutionContext, ActionResult } from "../types";
import * as linearActions from "./linear/actions";
import * as sentryActions from "./sentry/actions";
import * as slackActions from "./slack/actions";

// ============================================
// Types
// ============================================

export interface ProviderActionModule {
	actions: ActionDefinition[];
	guide?: string;
	execute(
		actionId: string,
		params: Record<string, unknown>,
		ctx: ActionExecutionContext,
	): Promise<ActionResult>;
}

// ============================================
// Registry
// ============================================

const registry = new Map<string, ProviderActionModule>();

registry.set("linear", linearActions);
registry.set("sentry", sentryActions);
registry.set("slack", slackActions);

/**
 * Get the action module for a provider by ID.
 */
export function getProviderActions(providerId: string): ProviderActionModule | undefined {
	return registry.get(providerId);
}

/**
 * List all registered provider action modules.
 */
export function listProviderActions(): Array<{ providerId: string; module: ProviderActionModule }> {
	return Array.from(registry.entries()).map(([providerId, module]) => ({
		providerId,
		module,
	}));
}
