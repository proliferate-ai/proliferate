/**
 * LiteLLM Admin REST API wrapper.
 *
 * Used by billing workers to sync spend logs without reaching into LiteLLM's DB schema.
 */

import { env } from "@proliferate/environment/server";

export interface LiteLLMSpendLog {
	request_id: string;
	team_id: string | null;
	user: string | null;
	spend: number;
	model: string;
	model_group: string | null;
	total_tokens: number | null;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	startTime: string | null;
	endTime: string | null;
	status: string | null;
	metadata: unknown;
}

export interface LiteLLMSpendLogsPage {
	data: LiteLLMSpendLog[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
}

function getAdminConfig(): { adminUrl: string; masterKey: string } {
	const proxyUrl = env.LLM_PROXY_ADMIN_URL || env.LLM_PROXY_URL;
	const masterKey = env.LLM_PROXY_MASTER_KEY;
	if (!proxyUrl) {
		throw new Error("LLM_PROXY_URL is required to fetch LiteLLM spend logs");
	}
	if (!masterKey) {
		throw new Error("LLM_PROXY_MASTER_KEY is required to fetch LiteLLM spend logs");
	}

	const adminUrl = proxyUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
	return { adminUrl, masterKey };
}

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

/**
 * LiteLLM `/spend/logs/v2` expects UTC timestamps in `YYYY-MM-DD HH:MM:SS` format.
 */
export function formatLiteLLMDateUtc(date: Date): string {
	return [
		`${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
		`${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`,
	].join(" ");
}

export async function listSpendLogsV2(input: {
	teamId: string;
	startDate: Date;
	endDate: Date;
	page: number;
	pageSize: number;
	sortBy?: "startTime" | "endTime" | "spend" | "total_tokens";
	sortOrder?: "asc" | "desc";
}): Promise<LiteLLMSpendLogsPage> {
	const { adminUrl, masterKey } = getAdminConfig();

	const url = new URL(`${adminUrl}/spend/logs/v2`);
	url.searchParams.set("team_id", input.teamId);
	url.searchParams.set("start_date", formatLiteLLMDateUtc(input.startDate));
	url.searchParams.set("end_date", formatLiteLLMDateUtc(input.endDate));
	url.searchParams.set("page", String(input.page));
	url.searchParams.set("page_size", String(input.pageSize));
	url.searchParams.set("sort_by", input.sortBy ?? "startTime");
	url.searchParams.set("sort_order", input.sortOrder ?? "asc");

	const response = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${masterKey}`,
		},
		signal: AbortSignal.timeout(30_000),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`LiteLLM spend logs error: ${response.status} ${error}`);
	}

	return (await response.json()) as LiteLLMSpendLogsPage;
}
