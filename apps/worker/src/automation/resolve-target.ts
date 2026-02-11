/**
 * Target resolution for automation runs.
 *
 * Determines which prebuild/repo to use for session creation
 * based on enrichment output and automation configuration.
 */

import { prebuilds, repos } from "@proliferate/services";
import type { runs } from "@proliferate/services";
import type { EnrichmentPayload } from "./enrich";

export interface TargetResolution {
	type: "default" | "selected" | "fallback";
	prebuildId?: string;
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

	const defaultPrebuildId = automation?.defaultPrebuildId ?? undefined;

	if (!automation?.allowAgenticRepoSelection) {
		return {
			type: "default",
			prebuildId: defaultPrebuildId,
			reason: "selection_disabled",
		};
	}

	const suggestedRepoId = extractSuggestedRepoId(enrichmentJson);
	if (!suggestedRepoId) {
		return {
			type: "default",
			prebuildId: defaultPrebuildId,
			reason: "no_suggestion",
		};
	}

	const repoValid = await repos.repoExists(suggestedRepoId, organizationId);
	if (!repoValid) {
		return {
			type: "fallback",
			prebuildId: defaultPrebuildId,
			reason: "repo_not_found_or_wrong_org",
			suggestedRepoId,
		};
	}

	// Reuse an existing managed prebuild that already contains this repo
	// to avoid creating a new prebuild + setup session on every run.
	const existingPrebuildId = await findManagedPrebuildForRepo(suggestedRepoId, organizationId);
	if (existingPrebuildId) {
		return {
			type: "selected",
			prebuildId: existingPrebuildId,
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

async function findManagedPrebuildForRepo(
	repoId: string,
	organizationId: string,
): Promise<string | null> {
	const managed = await prebuilds.findManagedPrebuilds();
	const match = managed.find((p) =>
		p.prebuildRepos?.some(
			(pr) => pr.repo?.id === repoId && pr.repo?.organizationId === organizationId,
		),
	);
	return match?.id ?? null;
}
