/**
 * Configuration Selector Service
 *
 * LLM-based selection of configurations for agent_decide strategy.
 * Uses LiteLLM proxy to call a fast model that picks the best configuration
 * from an allowlisted set based on context (enrichment data or Slack message).
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import { configurations } from "@proliferate/services";

// ============================================
// Types
// ============================================

/** Input to the configuration selector */
export interface ConfigurationSelectorInput {
	/** Allowlisted configuration IDs */
	allowedConfigurationIds: string[];
	/** Contextual information for the LLM to decide (enrichment summary, Slack message, etc.) */
	context: string;
	/** Organization ID (for spend tracking) */
	organizationId: string;
}

/** Successful selection result */
export interface ConfigurationSelectorSuccess {
	status: "selected";
	configurationId: string;
	rationale: string;
}

/** Failed selection result */
export interface ConfigurationSelectorFailure {
	status: "failed";
	reason: string;
}

export type ConfigurationSelectorResult =
	| ConfigurationSelectorSuccess
	| ConfigurationSelectorFailure;

/** Shape of the LLM response we expect */
interface LLMSelectionResponse {
	configurationId: string;
	rationale: string;
}

// Model to use for selection (fast, cheap)
const SELECTOR_MODEL = "claude-haiku-4-5-20251001";
const SELECTOR_TIMEOUT_MS = 15_000;

// ============================================
// Core selector
// ============================================

/**
 * Select a configuration using an LLM call.
 *
 * 1. Fetches candidate configurations (only those with routing descriptions)
 * 2. Calls LLM to pick the best match
 * 3. Validates the selection is in the eligible set
 *
 * Returns a failure result (never throws) so callers can handle gracefully.
 */
export async function selectConfiguration(
	input: ConfigurationSelectorInput,
	logger: Logger,
): Promise<ConfigurationSelectorResult> {
	const { allowedConfigurationIds, context, organizationId } = input;

	// 1. Fetch candidate metadata
	const candidates = await configurations.getConfigurationCandidates(
		allowedConfigurationIds,
		organizationId,
	);

	// 2. Filter to only those with non-empty routing descriptions
	const eligible = candidates.filter(
		(c) => c.routingDescription && c.routingDescription.trim().length > 0,
	);

	if (eligible.length === 0) {
		return {
			status: "failed",
			reason: "no_eligible_candidates",
		};
	}

	// 3. Build the LLM prompt
	const systemPrompt = buildSystemPrompt(eligible);
	const userPrompt = buildUserPrompt(context);

	// 4. Call the LLM
	try {
		const response = await callLLM(systemPrompt, userPrompt, organizationId);

		if (!response) {
			return { status: "failed", reason: "empty_llm_response" };
		}

		// 5. Parse and validate
		const parsed = parseSelectionResponse(response);
		if (!parsed) {
			logger.warn({ response }, "Invalid LLM selection response format");
			return { status: "failed", reason: "invalid_llm_response" };
		}

		// 6. Verify selected ID is in eligible set
		const isEligible = eligible.some((c) => c.id === parsed.configurationId);
		if (!isEligible) {
			logger.warn(
				{ selectedId: parsed.configurationId, eligibleIds: eligible.map((c) => c.id) },
				"LLM selected configuration not in eligible set",
			);
			return { status: "failed", reason: "selected_id_not_in_eligible_set" };
		}

		return {
			status: "selected",
			configurationId: parsed.configurationId,
			rationale: parsed.rationale,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		logger.error({ err }, "Configuration selector LLM call failed");
		return { status: "failed", reason: `llm_call_failed: ${message}` };
	}
}

// ============================================
// Prompt construction
// ============================================

type ConfigurationCandidate = Awaited<
	ReturnType<typeof configurations.getConfigurationCandidates>
>[number];

function buildSystemPrompt(candidates: ConfigurationCandidate[]): string {
	const candidateList = candidates
		.map((c) => {
			const repos = c.repoNames.length > 0 ? c.repoNames.join(", ") : "no repos";
			return `- ID: ${c.id}\n  Name: ${c.name}\n  Description: ${c.routingDescription}\n  Repos: ${repos}`;
		})
		.join("\n\n");

	return `You are a configuration selector. Your job is to pick the best configuration for a task based on context.

Available configurations:

${candidateList}

Rules:
- You MUST select exactly one configuration from the list above.
- Base your decision on how well the configuration's description and repos match the context.
- If no configuration is a clear match, pick the closest one.
- Respond with ONLY a JSON object: {"configurationId": "<id>", "rationale": "<brief explanation>"}
- Do not include any other text, markdown, or formatting.`;
}

function buildUserPrompt(context: string): string {
	return `Select the best configuration for this task:\n\n${context}`;
}

// ============================================
// LLM call via LiteLLM proxy
// ============================================

async function callLLM(
	systemPrompt: string,
	userPrompt: string,
	organizationId: string,
): Promise<string | null> {
	const proxyUrl = env.LLM_PROXY_ADMIN_URL || env.LLM_PROXY_URL;
	const masterKey = env.LLM_PROXY_MASTER_KEY;

	if (!proxyUrl || !masterKey) {
		throw new Error("LLM proxy not configured (LLM_PROXY_URL and LLM_PROXY_MASTER_KEY required)");
	}

	const baseUrl = proxyUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), SELECTOR_TIMEOUT_MS);

	try {
		const response = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${masterKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: SELECTOR_MODEL,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				max_tokens: 256,
				temperature: 0,
				metadata: {
					team_id: organizationId,
					tags: ["configuration_selector"],
				},
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`LLM proxy returned ${response.status}: ${errorText}`);
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};

		return data.choices?.[0]?.message?.content?.trim() ?? null;
	} finally {
		clearTimeout(timeout);
	}
}

// ============================================
// Response parsing
// ============================================

function parseSelectionResponse(raw: string): LLMSelectionResponse | null {
	try {
		// Strip markdown code fences if present
		const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
		const parsed = JSON.parse(cleaned);

		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof parsed.configurationId === "string" &&
			parsed.configurationId.length > 0 &&
			typeof parsed.rationale === "string"
		) {
			return {
				configurationId: parsed.configurationId,
				rationale: parsed.rationale,
			};
		}

		return null;
	} catch {
		return null;
	}
}

// ============================================
// Context builders (used by callers)
// ============================================

/**
 * Build context string from automation enrichment payload.
 */
export function buildEnrichmentContext(enrichmentJson: unknown): string {
	if (!enrichmentJson || typeof enrichmentJson !== "object") {
		return "No enrichment context available.";
	}

	const enrichment = enrichmentJson as Record<string, unknown>;
	const parts: string[] = [];

	const summary = enrichment.summary as { title?: string; description?: string } | undefined;
	if (summary?.title) parts.push(`Title: ${summary.title}`);
	if (summary?.description) parts.push(`Description: ${summary.description}`);

	const source = enrichment.source as { url?: string; eventType?: string } | undefined;
	if (source?.eventType) parts.push(`Event type: ${source.eventType}`);
	if (source?.url) parts.push(`Source URL: ${source.url}`);

	const provider = enrichment.provider as string | undefined;
	if (provider) parts.push(`Provider: ${provider}`);

	const relatedFiles = enrichment.relatedFiles as string[] | undefined;
	if (relatedFiles && relatedFiles.length > 0) {
		parts.push(`Related files: ${relatedFiles.slice(0, 10).join(", ")}`);
	}

	return parts.length > 0 ? parts.join("\n") : "No enrichment context available.";
}

/**
 * Build context string from a Slack message.
 */
export function buildSlackMessageContext(content: string, channelName?: string): string {
	const parts: string[] = [];
	if (channelName) parts.push(`Slack channel: ${channelName}`);
	parts.push(`Message: ${content}`);
	return parts.join("\n");
}
