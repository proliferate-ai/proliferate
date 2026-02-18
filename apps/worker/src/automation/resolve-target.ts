/**
 * Target resolution for automation runs.
 *
 * Determines which configuration/repo to use for session creation
 * based on enrichment output and automation configuration.
 */

import { configurations, repos } from "@proliferate/services";
import type { runs } from "@proliferate/services";
import type { EnrichmentPayload } from "./enrich";

export interface TargetResolution {
	type: "default" | "selected" | "fallback";
	configurationId?: string;
	repoIds?: string[];
	reason: string;
	suggestedRepoId?: string;
}

export async function resolveTarget(input: {
	automation: runs.AutomationRunWithRelations["automation"];
	enrichmentJson: unknown;
	organizationId: string;
}): Promise<TargetResolution> {
	const { automation, enrichmentJson, organizationId } = input;

	const defaultConfigurationId = automation?.defaultConfigurationId ?? undefined;

	if (!automation?.allowAgenticRepoSelection) {
		return {
			type: "default",
			configurationId: defaultConfigurationId,
			reason: "selection_disabled",
		};
	}

	const suggestedRepoId = extractSuggestedRepoId(enrichmentJson);
	if (!suggestedRepoId) {
		return {
			type: "default",
			configurationId: defaultConfigurationId,
			reason: "no_suggestion",
		};
	}

	const repoValid = await repos.repoExists(suggestedRepoId, organizationId);
	if (!repoValid) {
		return {
			type: "fallback",
			configurationId: defaultConfigurationId,
			reason: "repo_not_found_or_wrong_org",
			suggestedRepoId,
		};
	}

	// Reuse an existing managed configuration that already contains this repo
	// to avoid creating a new configuration + setup session on every run.
	const existingConfigurationId = await findManagedConfigurationForRepo(
		suggestedRepoId,
		organizationId,
	);
	if (existingConfigurationId) {
		return {
			type: "selected",
			configurationId: existingConfigurationId,
			reason: "enrichment_suggestion_reused",
			suggestedRepoId,
		};
	}

	return {
		type: "selected",
		repoIds: [suggestedRepoId],
		reason: "enrichment_suggestion_new",
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

async function findManagedConfigurationForRepo(
	repoId: string,
	organizationId: string,
): Promise<string | null> {
	const managed = await configurations.findManagedConfigurations();
	const match = managed.find((c) =>
		c.configurationRepos?.some(
			(cr) => cr.repo?.id === repoId && cr.repo?.organizationId === organizationId,
		),
	);
	return match?.id ?? null;
}
