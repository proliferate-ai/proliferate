"use client";

import type { CreatorFilter, FilterTab, OriginFilter } from "@/config/sessions";
import {
	type SessionListResult,
	buildSessionListResult,
	deriveSessionState,
} from "@/lib/sessions/overall-work-state";
import type { PendingRunSummary } from "@proliferate/shared/contracts/automations";
import type { Session } from "@proliferate/shared/contracts/sessions";
import { useMemo } from "react";

export function useOverallWorkState(session: Session, pendingRun?: PendingRunSummary) {
	return useMemo(() => deriveSessionState(session, pendingRun), [session, pendingRun]);
}

export function useSessionListState({
	sessions,
	activeTab,
	searchQuery,
	originFilter,
	creatorFilter,
	currentUserId,
	automationOriginValue,
	pendingRuns,
	enableSorting,
}: {
	sessions: Session[] | undefined;
	activeTab: FilterTab;
	searchQuery: string;
	originFilter: OriginFilter;
	creatorFilter?: CreatorFilter;
	currentUserId?: string;
	automationOriginValue: OriginFilter;
	pendingRuns: PendingRunSummary[] | undefined;
	enableSorting?: boolean;
}) {
	const pendingRunsBySession = useMemo(() => {
		const map = new Map<string, PendingRunSummary>();
		if (!pendingRuns) return map;
		for (const run of pendingRuns) {
			if (run.session_id && !map.has(run.session_id)) {
				map.set(run.session_id, run);
			}
		}
		return map;
	}, [pendingRuns]);

	const result: SessionListResult = useMemo(
		() =>
			buildSessionListResult({
				sessions,
				activeTab,
				searchQuery,
				originFilter,
				creatorFilter,
				currentUserId,
				automationOriginValue,
				pendingRunsBySession,
				enableSorting,
			}),
		[
			sessions,
			activeTab,
			searchQuery,
			originFilter,
			creatorFilter,
			currentUserId,
			automationOriginValue,
			pendingRunsBySession,
			enableSorting,
		],
	);

	return { pendingRunsBySession, result };
}
