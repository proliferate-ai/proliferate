/**
 * Target resolution for automation runs.
 *
 * Determines which configuration/repo to use for session creation
 * based on enrichment output and automation configuration.
 *
 * Key invariant: `agent_decide` mode never creates new managed configurations.
 * It can only select from existing configurations in the allowed set.
 */

import { configurations, repos } from "@proliferate/services";
import type { runs } from "@proliferate/services";
import type { EnrichmentPayload } from "./enrich";

export interface TargetResolution {
	type: "default" | "selected" | "fallback";
	configurationId?: string;
	/** @deprecated Never emitted in agent_decide mode. Only used for legacy selection_disabled path. */
	repoIds?: string[];
	reason: string;
	suggestedRepoId?: string;
}

type AutomationType = runs.AutomationRunWithRelations["automation"];

export async function resolveTarget(input: {
	automation: AutomationType;
	enrichmentJson: unknown;
	organizationId: string;
}): Promise<TargetResolution> {
	const { automation, enrichmentJson, organizationId } = input;

	const strategy = automation?.configSelectionStrategy ?? "fixed";
	const defaultConfigurationId = automation?.defaultConfigurationId ?? undefined;
	const fallbackConfigurationId = automation?.fallbackConfigurationId ?? defaultConfigurationId;

	// Strategy: fixed — always use default configuration
	if (strategy === "fixed" || !automation?.allowAgenticRepoSelection) {
		return {
			type: "default",
			configurationId: defaultConfigurationId,
			reason: "selection_disabled",
		};
	}

	// Strategy: agent_decide — choose from allowed configurations only
	// Never create new managed configurations in this mode.
	const suggestedRepoId = extractSuggestedRepoId(enrichmentJson);
	if (!suggestedRepoId) {
		return {
			type: "fallback",
			configurationId: fallbackConfigurationId,
			reason: "no_suggestion",
		};
	}

	const repoValid = await repos.repoExists(suggestedRepoId, organizationId);
	if (!repoValid) {
		return {
			type: "fallback",
			configurationId: fallbackConfigurationId,
			reason: "repo_not_found_or_wrong_org",
			suggestedRepoId,
		};
	}

	// Build the candidate set: allowed configuration IDs or all ready configs
	const allowedIds = (automation.allowedConfigurationIds as string[] | null) ?? null;
	const existingConfigurationId = await findConfigurationForRepo(
		suggestedRepoId,
		organizationId,
		allowedIds,
	);

	if (existingConfigurationId) {
		return {
			type: "selected",
			configurationId: existingConfigurationId,
			reason: "enrichment_suggestion_reused",
			suggestedRepoId,
		};
	}

	// In agent_decide mode, if no existing config matches the repo,
	// fall back to the fallback configuration. Never create new managed configs.
	return {
		type: "fallback",
		configurationId: fallbackConfigurationId,
		reason: "no_matching_config_in_allowlist",
		suggestedRepoId,
	};
}

function extractSuggestedRepoId(enrichmentJson: unknown): string | null {
	if (!enrichmentJson || typeof enrichmentJson !== "object") return null;
	const payload = enrichmentJson as Partial<EnrichmentPayload>;
	if (payload.version !== 1) return null;
	if (typeof payload.suggestedRepoId !== "string" || payload.suggestedRepoId.length === 0)
		return null;
	return payload.suggestedRepoId;
}

/**
 * Find an existing configuration that contains the given repo.
 * If allowedIds is provided, only search within that set.
 */
async function findConfigurationForRepo(
	repoId: string,
	organizationId: string,
	allowedIds: string[] | null,
): Promise<string | null> {
	const managed = await configurations.findManagedConfigurations();
	const match = managed.find((c) => {
		// If allowlist is set, only consider configs in the list
		if (allowedIds && !allowedIds.includes(c.id)) return false;
		return c.configurationRepos?.some(
			(cr) => cr.repo?.id === repoId && cr.repo?.organizationId === organizationId,
		);
	});
	return match?.id ?? null;
}
