/**
 * Session title generation.
 *
 * Generates session titles via LLM (Haiku) and manages the BullMQ queue
 * for async title generation at session creation time.
 */

import { env } from "@proliferate/environment/server";
import {
	type SessionTitleGenerationJob,
	createSessionTitleGenerationQueue,
} from "@proliferate/queue";
import type { Queue } from "@proliferate/queue";
import { getServicesLogger } from "../logger";

const MAX_TITLE_LENGTH = 50;

// ============================================
// LLM Title Generation
// ============================================

/**
 * Generate a concise session title from the user's initial prompt using an LLM.
 * Falls back to simple text extraction if the API call fails or no key is configured.
 */
export async function generateSessionTitle(prompt: string): Promise<string> {
	const logger = getServicesLogger().child({ module: "session-title" });
	const apiKey = env.ANTHROPIC_API_KEY;

	if (!apiKey) {
		logger.warn("No ANTHROPIC_API_KEY configured, falling back to text extraction");
		return deriveTitleFromPrompt(prompt) ?? "New session";
	}

	try {
		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: "claude-haiku-4-5-20251001",
				max_tokens: 30,
				system:
					"Generate a concise 3-8 word title for a coding session based on the user's request. Return only the title, nothing else. No quotes, no punctuation at the end.",
				messages: [{ role: "user", content: prompt }],
			}),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			logger.error(
				{ status: response.status, error: errorText.slice(0, 200) },
				"Anthropic API error during title generation",
			);
			return deriveTitleFromPrompt(prompt) ?? "New session";
		}

		const data = (await response.json()) as {
			content: Array<{ type: string; text?: string }>;
		};
		const textBlock = data.content.find((block) => block.type === "text");

		if (!textBlock?.text) {
			logger.warn("No text content in Anthropic API response");
			return deriveTitleFromPrompt(prompt) ?? "New session";
		}

		const title = textBlock.text.trim();
		return title.length > MAX_TITLE_LENGTH ? title.slice(0, MAX_TITLE_LENGTH) : title;
	} catch (err) {
		logger.error({ err }, "Failed to generate session title via LLM");
		return deriveTitleFromPrompt(prompt) ?? "New session";
	}
}

// ============================================
// Text Extraction Fallback
// ============================================

/**
 * Derive a title from the prompt by extracting the first sentence.
 * Used as a fallback when LLM generation is unavailable.
 */
export function deriveTitleFromPrompt(content: string): string | null {
	const cleaned = content
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (!cleaned) return null;

	const punctuationIndex = cleaned.search(/[.!?]/);
	const baseTitle = (punctuationIndex === -1 ? cleaned : cleaned.slice(0, punctuationIndex)).trim();
	if (!baseTitle) return null;

	return baseTitle.length > MAX_TITLE_LENGTH ? baseTitle.slice(0, MAX_TITLE_LENGTH) : baseTitle;
}

// ============================================
// Queue Management
// ============================================

let titleGenerationQueue: Queue<SessionTitleGenerationJob> | null = null;

function getTitleGenerationQueue() {
	if (!titleGenerationQueue) {
		titleGenerationQueue = createSessionTitleGenerationQueue();
	}
	return titleGenerationQueue;
}

/**
 * Enqueue a session title generation job.
 * Fire-and-forget: logs warnings on failure but does not throw.
 */
export async function requestTitleGeneration(
	sessionId: string,
	orgId: string,
	prompt: string,
): Promise<void> {
	const logger = getServicesLogger().child({ module: "session-title" });

	try {
		const queue = getTitleGenerationQueue();
		const jobId = `title:${sessionId}`;
		await queue.add(`title:${sessionId}`, { sessionId, orgId, prompt }, { jobId });
		logger.info({ sessionId }, "Enqueued session title generation job");
	} catch (err) {
		logger.warn({ err, sessionId }, "Failed to enqueue session title generation");
	}
}
