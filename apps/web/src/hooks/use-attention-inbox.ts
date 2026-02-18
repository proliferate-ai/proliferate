"use client";

import { useOrgActions } from "@/hooks/use-actions";
import { useOrgPendingRuns } from "@/hooks/use-automations";
import type { PendingRunSummary } from "@proliferate/shared";
import type { ActionApprovalRequestMessage } from "@proliferate/shared";
import { useMemo } from "react";

type ActionApproval = ActionApprovalRequestMessage["payload"];

/** Approval with an associated sessionId for making HTTP calls. */
export interface ApprovalWithSession {
	approval: ActionApproval;
	sessionId: string;
	sessionTitle?: string | null;
}

export type AttentionItem =
	| { type: "approval"; data: ApprovalWithSession; timestamp: number }
	| { type: "run"; data: PendingRunSummary; timestamp: number };

/**
 * Merges current-session WebSocket approvals with org-level polled approvals
 * and org pending runs into a single sorted attention list.
 */
export function useAttentionInbox(options: {
	/** Current session's WS-delivered approvals. */
	wsApprovals: ActionApproval[];
	/** Current session ID (to avoid showing org-polled duplicates). */
	sessionId?: string;
}) {
	const { wsApprovals, sessionId } = options;

	const { data: orgActions } = useOrgActions({ status: "pending", limit: 50 });
	const { data: pendingRuns } = useOrgPendingRuns({ limit: 50, unassignedOnly: true });

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
				result.push({
					type: "run",
					data: run,
					timestamp: run.completed_at
						? new Date(run.completed_at).getTime()
						: new Date(run.queued_at).getTime(),
				});
			}
		}

		// Sort newest first
		result.sort((a, b) => b.timestamp - a.timestamp);

		return result;
	}, [wsApprovals, orgActions, pendingRuns, sessionId]);

	return items;
}
