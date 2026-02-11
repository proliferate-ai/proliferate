/**
 * Enrichment computation for automation runs.
 *
 * Pure deterministic extraction from trigger context — no external calls.
 */

import type { runs } from "@proliferate/services";
import type { ParsedEventContext } from "@proliferate/triggers";

export class EnrichmentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EnrichmentError";
	}
}

export interface EnrichmentPayload {
	version: 1;
	provider: string;
	summary: {
		title: string;
		description: string | null;
	};
	source: {
		url: string | null;
		externalId: string | null;
		eventType: string | null;
	};
	relatedFiles: string[];
	suggestedRepoId: string | null;
	providerContext: Record<string, unknown>;
	automationContext: {
		automationId: string;
		automationName: string;
		hasLlmFilter: boolean;
		hasLlmAnalysis: boolean;
	};
}

export function buildEnrichmentPayload(
	context: runs.AutomationRunWithRelations,
): EnrichmentPayload {
	const { automation, triggerEvent, trigger } = context;
	if (!automation || !triggerEvent || !trigger) {
		throw new EnrichmentError("Missing automation, trigger, or trigger event");
	}

	const parsed = triggerEvent.parsedContext as ParsedEventContext | null;
	if (!parsed || typeof parsed !== "object") {
		throw new EnrichmentError("parsedContext is missing or not an object");
	}

	if (!parsed.title) {
		throw new EnrichmentError("parsedContext.title is required");
	}

	return {
		version: 1,
		provider: trigger.provider,
		summary: {
			title: parsed.title,
			description: parsed.description ?? null,
		},
		source: {
			url: extractSourceUrl(parsed),
			externalId: triggerEvent.externalEventId,
			eventType: triggerEvent.providerEventType,
		},
		relatedFiles: parsed.relatedFiles ?? [],
		suggestedRepoId: parsed.suggestedRepoId ?? null,
		providerContext: extractProviderContext(parsed),
		automationContext: {
			automationId: automation.id,
			automationName: automation.name,
			hasLlmFilter: !!automation.llmFilterPrompt,
			hasLlmAnalysis: !!automation.llmAnalysisPrompt,
		},
	};
}

export function extractSourceUrl(parsed: ParsedEventContext): string | null {
	if (parsed.linear?.issueUrl) return parsed.linear.issueUrl;
	if (parsed.sentry?.issueUrl) return parsed.sentry.issueUrl;
	if (parsed.github) {
		return (
			parsed.github.issueUrl ??
			parsed.github.prUrl ??
			parsed.github.compareUrl ??
			parsed.github.workflowUrl ??
			null
		);
	}
	if (parsed.posthog?.eventUrl) return parsed.posthog.eventUrl;
	return null;
}

function extractProviderContext(parsed: ParsedEventContext): Record<string, unknown> {
	if (parsed.linear) return { ...parsed.linear };
	if (parsed.sentry) return { ...parsed.sentry };
	if (parsed.github) return { ...parsed.github };
	if (parsed.posthog) return { ...parsed.posthog };
	if (parsed.gmail) return { ...parsed.gmail };
	return {};
}
