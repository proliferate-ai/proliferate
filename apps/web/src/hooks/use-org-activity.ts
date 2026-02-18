"use client";

import type { AutomationRunStatus } from "@proliferate/shared";
import { useOrgRuns } from "./use-automations";

/**
 * Org-wide activity feed — all automation runs across all automations.
 * Wraps useOrgRuns with convenient defaults.
 */
export function useOrgActivity(options?: {
	status?: AutomationRunStatus;
	limit?: number;
	offset?: number;
}) {
	const { data, isLoading, error } = useOrgRuns(options);

	return {
		runs: data?.runs ?? [],
		total: data?.total ?? 0,
		isLoading,
		error,
	};
}
