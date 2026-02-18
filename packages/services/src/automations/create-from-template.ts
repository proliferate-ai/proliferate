/**
 * Create an automation from a template in a single transaction.
 *
 * Security invariants:
 *   S1 — All write-action modes are forced to "require_approval"
 *   S2 — Automation is created in paused state (enabled: false)
 *   S3 — All integration bindings are validated (org ownership + active status + provider match)
 */

import { randomBytes, randomUUID } from "crypto";
import type { AutomationListItem } from "@proliferate/shared/contracts";
import {
	and,
	automationConnections,
	automations,
	eq,
	getDb,
	integrations,
	triggers,
} from "../db/client";
import { getTemplateById } from "../templates/catalog";
import type { AutomationTemplate } from "../templates/types";
import { toNewAutomationListItem } from "./mapper";

// ============================================
// Types
// ============================================

export interface CreateFromTemplateInput {
	templateId: string;
	/** Map of provider -> integrationId for binding triggers + connections */
	integrationBindings: Record<string, string>;
}

interface ValidatedIntegration {
	id: string;
	/** The DB provider column (e.g., "nango", "github-app") */
	provider: string;
	/** The DB integration_id column — the actual service (e.g., "github", "linear") */
	integrationId: string;
	status: string | null;
}

// ============================================
// Main function
// ============================================

/**
 * Create a fully-configured automation from a template.
 * Runs inside a single database transaction — all or nothing.
 */
export async function createFromTemplate(
	orgId: string,
	userId: string,
	input: CreateFromTemplateInput,
): Promise<AutomationListItem> {
	const template = getTemplateById(input.templateId);
	if (!template) {
		throw new Error(`Template not found: ${input.templateId}`);
	}

	// S3: Validate all integration bindings before starting transaction
	const validatedIntegrations = await validateIntegrationBindings(orgId, input.integrationBindings);

	const db = getDb();

	return await db.transaction(async (tx) => {
		// 1. Insert automation row (S2: enabled: false)
		const [automationRow] = await tx
			.insert(automations)
			.values({
				organizationId: orgId,
				name: template.name,
				description: template.description,
				agentInstructions: template.agentInstructions,
				modelId: template.modelId ?? "claude-sonnet-4-20250514",
				enabledTools: sanitizeEnabledTools(template.enabledTools),
				enabled: false, // S2: Default to paused
				sourceTemplateId: template.id,
				createdBy: userId,
			})
			.returning();

		const automationId = automationRow.id;

		// 2. Insert triggers with validated integration bindings
		for (const triggerDef of template.triggers) {
			// Use validated integration ID (not raw input) to prevent mismatched bindings
			const validated = validatedIntegrations.get(triggerDef.provider);
			const integrationId = validated?.id ?? null;

			const webhookUrlPath = `/webhooks/t_${randomUUID().slice(0, 12)}`;
			const webhookSecret = randomBytes(32).toString("hex");

			await tx.insert(triggers).values({
				automationId,
				organizationId: orgId,
				name: `${template.name} - ${triggerDef.provider}`,
				provider: triggerDef.provider,
				triggerType: triggerDef.triggerType,
				enabled: true,
				config: triggerDef.config,
				integrationId,
				webhookUrlPath,
				webhookSecret,
				pollingCron: triggerDef.cronExpression ?? null,
				createdBy: userId,
			});
		}

		// 3. Insert automation_connections for each validated integration
		const seenIntegrationIds = new Set<string>();
		for (const validated of validatedIntegrations.values()) {
			if (!seenIntegrationIds.has(validated.id)) {
				seenIntegrationIds.add(validated.id);
				await tx.insert(automationConnections).values({
					automationId,
					integrationId: validated.id,
				});
			}
		}

		// 4. Set action modes (S1: force require_approval for write actions)
		if (template.actionModes) {
			const safeModes = forceWriteApproval(template.actionModes);
			await tx
				.update(automations)
				.set({ actionModes: safeModes })
				.where(eq(automations.id, automationId));
		}

		// Return the automation row for the response.
		// Use toNewAutomationListItem with empty counts — the frontend navigates
		// to the detail page immediately and will refetch full data.
		return toNewAutomationListItem({
			...automationRow,
			defaultConfiguration: null,
		});
	});
}

// ============================================
// Helpers
// ============================================

/**
 * S3: Validate that all required integration bindings exist, belong to the org,
 * are active, and match the expected provider.
 *
 * Integration rows store:
 *   provider     = auth mechanism ("nango", "github-app")
 *   integrationId = actual service ("github", "linear", "sentry")
 *
 * We match binding keys (e.g., "github") against integrationId, not provider.
 */
async function validateIntegrationBindings(
	orgId: string,
	bindings: Record<string, string>,
): Promise<Map<string, ValidatedIntegration>> {
	const db = getDb();
	const validated = new Map<string, ValidatedIntegration>();

	// Don't enforce required integrations here — templates create paused drafts
	// (enabled: false). Users connect missing integrations before enabling.
	// We only validate bindings that are actually provided.

	// Validate each binding
	for (const [bindingKey, integrationId] of Object.entries(bindings)) {
		if (!integrationId) continue;

		const integration = await db.query.integrations.findFirst({
			where: and(eq(integrations.id, integrationId), eq(integrations.organizationId, orgId)),
			columns: { id: true, provider: true, integrationId: true, status: true },
		});

		if (!integration) {
			throw new Error(`Integration ${integrationId} not found in organization`);
		}

		if (integration.status !== "active") {
			throw new Error(`Integration ${integrationId} is not active (status: ${integration.status})`);
		}

		// Verify the integration's service type matches the binding key.
		// integrationId column holds the actual service (e.g., "github", "linear").
		if (integration.integrationId && integration.integrationId !== bindingKey) {
			throw new Error(
				`Integration ${integrationId} is for "${integration.integrationId}", not "${bindingKey}"`,
			);
		}

		validated.set(bindingKey, {
			id: integration.id,
			provider: integration.provider ?? bindingKey,
			integrationId: integration.integrationId ?? bindingKey,
			status: integration.status,
		});
	}

	return validated;
}

/**
 * S1: Force all write-action modes to "require_approval".
 * Templates cannot auto-allow write actions.
 */
function forceWriteApproval(
	modes: Record<string, "allow" | "require_approval" | "deny">,
): Record<string, "allow" | "require_approval" | "deny"> {
	const safe = { ...modes };
	for (const [key, mode] of Object.entries(safe)) {
		if (mode === "allow") {
			// Only read actions can be auto-allowed.
			// Since we can't reliably determine risk level from the key alone,
			// force everything to require_approval. Users can downgrade on the detail page.
			safe[key] = "require_approval";
		}
	}
	return safe;
}

/**
 * Sanitize enabled_tools from template to match the expected JSONB shape.
 */
function sanitizeEnabledTools(tools: AutomationTemplate["enabledTools"]): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	if (tools.slack_notify) result.slack_notify = tools.slack_notify;
	if (tools.create_linear_issue) result.create_linear_issue = tools.create_linear_issue;
	if (tools.email_user) result.email_user = tools.email_user;
	if (tools.create_session) result.create_session = tools.create_session;
	return result;
}
