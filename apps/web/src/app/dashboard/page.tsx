"use client";

export const dynamic = "force-dynamic";

import { EmptyDashboard } from "@/components/dashboard/empty-state";
import { useDashboardStore } from "@/stores/dashboard";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardPage() {
	const router = useRouter();
	const { activeSessionId, clearPendingPrompt } = useDashboardStore();

	// If there's an active session, redirect to the session page
	useEffect(() => {
		if (activeSessionId) {
			router.push(`/dashboard/sessions/${activeSessionId}`);
		}
	}, [activeSessionId, router]);

	// Clear any pending prompt when landing on this page
	useEffect(() => {
		clearPendingPrompt();
	}, [clearPendingPrompt]);

	// Show the new session creation empty state
	return <EmptyDashboard />;
}
