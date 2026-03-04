import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import type { Logger } from "@proliferate/logger";
import type { ManagerHarnessStartInput } from "@proliferate/shared/contracts";
import { BudgetExhaustedError } from "./wake-cycle/errors";

const MAX_RETRY_ATTEMPTS = 1;
const MODEL_ID = "claude-sonnet-4-5-20250929";

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createAnthropicClient(input: ManagerHarnessStartInput): Anthropic {
	const options: ClientOptions = { apiKey: input.anthropicApiKey };
	if (input.llmProxyUrl) {
		options.baseURL = input.llmProxyUrl;
	}
	return new Anthropic(options);
}

export async function callClaudeWithRetry(params: {
	client: Anthropic;
	logger: Logger;
	systemPrompt: string;
	conversationHistory: Anthropic.MessageParam[];
	tools: Anthropic.Tool[];
	abortSignal?: AbortSignal;
	retryCount?: number;
}): Promise<Anthropic.Message> {
	const {
		client,
		logger,
		systemPrompt,
		conversationHistory,
		tools,
		abortSignal,
		retryCount = 0,
	} = params;

	try {
		return await client.messages.create(
			{
				model: MODEL_ID,
				max_tokens: 4096,
				system: systemPrompt,
				messages: conversationHistory,
				tools,
			},
			{ signal: abortSignal },
		);
	} catch (err) {
		if (
			(err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) &&
			retryCount < MAX_RETRY_ATTEMPTS
		) {
			logger.warn({ retryCount, err }, "SDK error, retrying");
			await delay(2000 * (retryCount + 1));
			return callClaudeWithRetry({ ...params, retryCount: retryCount + 1 });
		}
		if (err instanceof Anthropic.APIError && err.status === 402) {
			throw new BudgetExhaustedError("API returned 402: budget exhausted");
		}
		throw err;
	}
}
