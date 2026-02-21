/**
 * LiteLLM Admin REST API Client
 *
 * Fetches spend logs via LiteLLM's REST API instead of cross-schema SQL queries.
 * Uses GET /spend/logs/v2 with api-key header auth.
 */

import { env } from "@proliferate/environment/server";
import { getServicesLogger } from "../logger";

// ============================================
// Types
// ============================================

export interface LiteLLMSpendLog {
	request_id: string;
	team_id: string | null;
	end_user: string | null;
	spend: number;
	model: string;
	model_group: string | null;
	total_tokens: number;
	prompt_tokens: number;
	completion_tokens: number;
	startTime?: string;
}

interface SpendLogsV2Response {
	data: LiteLLMSpendLog[];
}

// ============================================
// Client
// ============================================

function getAdminUrl(): string {
	const url = env.LLM_PROXY_ADMIN_URL || env.LLM_PROXY_URL;
	if (!url) {
		throw new Error("LLM_PROXY_ADMIN_URL (or LLM_PROXY_URL) is not configured");
	}
	return url.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function getMasterKey(): string {
	const key = env.LLM_PROXY_MASTER_KEY;
	if (!key) {
		throw new Error("LLM_PROXY_MASTER_KEY is not configured");
	}
	return key;
}

/**
 * Format a Date as "YYYY-MM-DD HH:MM:SS" (UTC) for LiteLLM's spend API.
 * LiteLLM v1.81+ rejects ISO 8601 format and requires this specific format.
 */
function formatDateForLiteLLM(date: Date): string {
	return date
		.toISOString()
		.replace("T", " ")
		.replace(/\.\d{3}Z$/, "");
}

/**
 * Fetch spend logs for a specific org (team) from LiteLLM's REST API.
 *
 * @param teamId - The org ID (maps to LiteLLM team_id)
 * @param startDate - Only return logs after this date
 * @param endDate - Only return logs before this date (defaults to now)
 */
export async function fetchSpendLogs(
	teamId: string,
	startDate: Date,
	endDate?: Date,
): Promise<LiteLLMSpendLog[]> {
	const logger = getServicesLogger().child({ module: "litellm-api", teamId });
	const baseUrl = getAdminUrl();
	const key = getMasterKey();

	const params = new URLSearchParams({
		team_id: teamId,
		start_date: formatDateForLiteLLM(startDate),
		end_date: formatDateForLiteLLM(endDate ?? new Date()),
	});

	const url = `${baseUrl}/spend/logs/v2?${params.toString()}`;

	const response = await fetch(url, {
		method: "GET",
		headers: {
			"api-key": key,
		},
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		logger.error(
			{ status: response.status, body: body.slice(0, 200) },
			"LiteLLM spend logs request failed",
		);
		throw new Error(`LiteLLM API error: ${response.status}`);
	}

	const json = (await response.json()) as SpendLogsV2Response;
	return json.data ?? [];
}
