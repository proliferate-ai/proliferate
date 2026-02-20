/**
 * Target resolution for automation runs.
 *
 * Determines which configuration/repo to use for session creation
 * based on enrichment output and automation configuration.
 *
 * Key invariant: `agent_decide` mode never creates new managed configurations.
 * It can only select from existing configurations in the allowed set.
 */

import type { Logger } from "@proliferate/logger";
import type { runs } from "@proliferate/services";
import { buildEnrichmentContext, selectConfiguration } from "./configuration-selector";

export interface TargetResolution {
	type: "default" | "selected" | "fallback" | "failed";
	configurationId?: string;
	reason: string;
}

type AutomationType = runs.AutomationRunWithRelations["automation"];

export async function resolveTarget(
	input: {
		automation: AutomationType;
		enrichmentJson: unknown;
		organizationId: string;
	},
	logger: Logger,
): Promise<TargetResolution> {
	const { automation, enrichmentJson, organizationId } = input;

	const strategy = automation?.configSelectionStrategy ?? "fixed";
	const defaultConfigurationId = automation?.defaultConfigurationId ?? undefined;

	// Strategy: fixed — always use default configuration
	if (strategy === "fixed" || !automation?.allowAgenticRepoSelection) {
		return {
			type: "default",
			configurationId: defaultConfigurationId,
			reason: "selection_disabled",
		};
	}

	// Strategy: agent_decide — choose from allowed configurations via LLM
	// Never create new managed configurations in this mode.
	const allowedIds = (automation.allowedConfigurationIds as string[] | null) ?? null;

	// Require an explicit allowlist for agent_decide — unbounded search is not safe
	if (!allowedIds || allowedIds.length === 0) {
		return {
			type: "failed",
			reason: "configuration_selection_failed",
		};
	}

	const context = buildEnrichmentContext(enrichmentJson);
	const result = await selectConfiguration(
		{
			allowedConfigurationIds: allowedIds,
			context,
			organizationId,
		},
		logger,
	);

	if (result.status === "selected") {
		return {
			type: "selected",
			configurationId: result.configurationId,
			reason: result.rationale,
		};
	}

	return {
		type: "failed",
		reason: "configuration_selection_failed",
	};
}
