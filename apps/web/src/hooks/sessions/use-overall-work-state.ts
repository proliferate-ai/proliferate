"use client";

import type { CreatorFilter, FilterTab, OriginFilter } from "@/config/sessions";
import {
	type SessionListResult,
	buildSessionListResult,
	deriveSessionState,
} from "@/lib/sessions/overall-work-state";
import type { PendingRunSummary } from "@proliferate/shared/contracts/automations";
import type { Session } from "@proliferate/shared/contracts/sessions";
import { useEffect, useMemo } from "react";

const loggedStateKeys = new Set<string>();

function isStatusDebugEnabled(): boolean {
	if (typeof window === "undefined") return false;
	try {
		const params = new URLSearchParams(window.location.search);
		if (params.get("statusDebug") === "1") return true;
		return window.localStorage.getItem("statusDebug") === "1";
	} catch {
		return false;
	}
}

export function useOverallWorkState(session: Session, pendingRun?: PendingRunSummary) {
	const derived = useMemo(() => deriveSessionState(session, pendingRun), [session, pendingRun]);

	useEffect(() => {
		if (!isStatusDebugEnabled()) return;
		const unread = session.hasUnreadUpdate ?? session.unread ?? false;
		const key = `${session.id}:${session.status.updatedAt ?? "none"}:${String(unread)}:${derived.overallWorkState}`;
		if (loggedStateKeys.has(key)) return;
		loggedStateKeys.add(key);
		console.info("[status-debug] deriveSessionState", {
			sessionId: session.id,
			sandboxState: session.status.sandboxState,
			agentState: session.status.agentState,
			terminalState: session.status.terminalState,
			reason: session.status.reason,
			requiresHumanReview: session.status.requiresHumanReview,
			agentFinishedIterating: session.status.agentFinishedIterating,
			hasUnreadUpdate: unread,
			overallWorkState: derived.overallWorkState,
			needsAttention: derived.needsAttention,
			isLive: derived.isLive,
		});
	}, [session, derived]);

	return derived;
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
