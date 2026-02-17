"use client";

export const dynamic = "force-dynamic";

import { EmptyDashboard } from "@/components/dashboard/empty-state";
import { useAttentionInbox } from "@/hooks/use-attention-inbox";
import { useDashboardStore } from "@/stores/dashboard";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardPage() {
	const router = useRouter();
	const { activeSessionId, clearPendingPrompt } = useDashboardStore();
	const inboxItems = useAttentionInbox({ wsApprovals: [] });

	// If there's an active session, redirect to the session page
	useEffect(() => {
		if (activeSessionId) {
			router.push(`/workspace/${activeSessionId}`);
		}
	}, [activeSessionId, router]);

	// If inbox has items and no active session, redirect to runs
	useEffect(() => {
		if (!activeSessionId && inboxItems.length > 0) {
			router.push("/dashboard/runs");
		}
	}, [activeSessionId, inboxItems.length, router]);

	// Clear any pending prompt when landing on this page
	useEffect(() => {
		clearPendingPrompt();
	}, [clearPendingPrompt]);

	// Show the new session creation empty state
	return <EmptyDashboard />;
}
