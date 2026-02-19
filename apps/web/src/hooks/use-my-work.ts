"use client";

import { useSession } from "@/lib/auth-client";
import { deriveDisplayStatus } from "@proliferate/shared/sessions";
import { useMemo } from "react";
import { useOrgActions } from "./use-actions";
import { useMyClaimedRuns } from "./use-automations";
import { useSessions } from "./use-sessions";

/**
 * Composes "My Work" — everything the current user is responsible for.
 * - Claimed automation runs (assigned to me)
 * - My active manual sessions (created by me, running/starting/paused, not automation-spawned)
 * - Pending approvals (org-wide for now, until per-user assignment exists)
 */
export function useMyWork() {
	const { data: session } = useSession();
	const userId = session?.user?.id;

	const { data: claimedRuns, isLoading: runsLoading } = useMyClaimedRuns();

	const { data: allSessions, isLoading: sessionsLoading } = useSessions({
		excludeSetup: true,
		excludeCli: true,
		excludeAutomation: true,
		createdBy: userId,
		enabled: !!userId,
	});

	const { data: approvals, isLoading: approvalsLoading } = useOrgActions({
		status: "pending",
		limit: 50,
	});

	const activeSessions = useMemo(
		() =>
			allSessions?.filter((s) => {
				const ds = deriveDisplayStatus(s.status, s.pauseReason);
				return ds === "active" || ds === "idle";
			}),
		[allSessions],
	);

	const pendingApprovals = approvals?.invocations ?? [];

	return {
		claimedRuns: claimedRuns ?? [],
		activeSessions: activeSessions ?? [],
		pendingApprovals,
		totalCount:
			(claimedRuns?.length ?? 0) + (activeSessions?.length ?? 0) + pendingApprovals.length,
		isLoading: runsLoading || sessionsLoading || approvalsLoading,
	};
}
