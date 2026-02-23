"use client";

import { useOrgActions } from "@/hooks/use-actions";
import { useOrgPendingRuns } from "@/hooks/use-automations";
import { orpc } from "@/lib/orpc";
import type { PendingRunSummary } from "@proliferate/shared";
import type { ActionApprovalRequestMessage } from "@proliferate/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

type ActionApproval = ActionApprovalRequestMessage["payload"];

/** Approval with an associated sessionId for making HTTP calls. */
export interface ApprovalWithSession {
	approval: ActionApproval;
	sessionId: string;
	sessionTitle?: string | null;
}

/** Blocked sessions grouped by billing reason for inbox rollup. */
export interface BlockedGroup {
	reason: string;
	count: number;
	previewSessions: Array<{
		id: string;
		title: string | null;
		promptSnippet: string | null;
		startedAt: string | null;
		pausedAt: string | null;
	}>;
}

export type AttentionItem =
	| { type: "approval"; data: ApprovalWithSession; timestamp: number }
	| { type: "run"; data: PendingRunSummary; timestamp: number }
	| { type: "blocked"; data: BlockedGroup; timestamp: number };

/**
 * Fetch billing-blocked session summary for inbox rollup.
 * Failure-isolated: if this query fails, approvals + runs still render.
 */
function useBlockedSummary() {
	const queryOptions = orpc.sessions.blockedSummary.queryOptions({ input: undefined });

	return useQuery({
		...queryOptions,
		refetchInterval: 30_000,
		queryFn: async (context) => {
			try {
				return await queryOptions.queryFn(context);
			} catch (error) {
				if (isAbortLikeError(error)) {
					return { groups: [] };
				}
				throw error;
			}
		},
		select: (data) => data.groups,
	});
}

function isAbortLikeError(error: unknown): boolean {
	if (!error) {
		return false;
	}
	if (error instanceof DOMException && error.name === "AbortError") {
		return true;
	}
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return (
			error.name === "AbortError" ||
			message.includes("operation was aborted") ||
			message.includes("signal is aborted")
		);
	}
	if (typeof error === "object" && error !== null) {
		const name = (error as { name?: unknown }).name;
		const message = (error as { message?: unknown }).message;
		return (
			name === "AbortError" ||
			(typeof message === "string" &&
				(message.toLowerCase().includes("operation was aborted") ||
					message.toLowerCase().includes("signal is aborted")))
		);
	}
	return false;
}

/**
 * Merges current-session WebSocket approvals with org-level polled approvals,
 * org pending runs, and blocked session groups into a single sorted attention list.
 */
export function useAttentionInbox(options: {
	/** Current session's WS-delivered approvals. */
	wsApprovals: ActionApproval[];
	/** Current session ID (to avoid showing org-polled duplicates). */
	sessionId?: string;
	/** Active automation runId in workspace context (if any). */
	runId?: string;
}) {
	const { wsApprovals, sessionId, runId } = options;

	const { data: orgActions } = useOrgActions({ status: "pending", limit: 50 });
	const { data: pendingRuns } = useOrgPendingRuns({ limit: 50, unassignedOnly: true });
	const { data: blockedGroups } = useBlockedSummary();

	const items = useMemo(() => {
		const result: AttentionItem[] = [];
		const seenInvocationIds = new Set<string>();

		// 1. WS approvals (current session) take priority
		for (const approval of wsApprovals) {
			seenInvocationIds.add(approval.invocationId);
			result.push({
				type: "approval",
				data: { approval, sessionId: sessionId ?? "" },
				timestamp: approval.expiresAt
					? new Date(approval.expiresAt).getTime() - 5 * 60 * 1000
					: Date.now(),
			});
		}

		// 2. Org-polled pending approvals (dedupe against WS)
		if (orgActions?.invocations) {
			for (const inv of orgActions.invocations) {
				if (seenInvocationIds.has(inv.id)) continue;
				seenInvocationIds.add(inv.id);
				const approval: ActionApproval = {
					invocationId: inv.id,
					integration: inv.integration,
					action: inv.action,
					riskLevel: inv.riskLevel,
					params: inv.params,
					expiresAt: inv.expiresAt ?? "",
				};
				result.push({
					type: "approval",
					data: { approval, sessionId: inv.sessionId, sessionTitle: inv.sessionTitle },
					timestamp: inv.createdAt ? new Date(inv.createdAt).getTime() : Date.now(),
				});
			}
		}

		// 3. Pending runs
		if (pendingRuns) {
			for (const run of pendingRuns) {
				if (runId && run.id !== runId) continue;
				result.push({
					type: "run",
					data: run,
					timestamp: run.completed_at
						? new Date(run.completed_at).getTime()
						: new Date(run.queued_at).getTime(),
				});
			}
		}

		// 4. Blocked groups (rolled up by billing reason)
		if (blockedGroups) {
			for (const group of blockedGroups) {
				result.push({
					type: "blocked",
					data: group,
					timestamp: Date.now(),
				});
			}
		}

		// Sort newest first
		result.sort((a, b) => b.timestamp - a.timestamp);

		return result;
	}, [wsApprovals, orgActions, pendingRuns, blockedGroups, sessionId, runId]);

	return items;
}
