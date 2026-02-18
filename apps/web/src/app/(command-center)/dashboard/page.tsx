"use client";

export const dynamic = "force-dynamic";

import { EmptyDashboard } from "@/components/dashboard/empty-state";
import { useDashboardStore } from "@/stores/dashboard";
import { useEffect } from "react";

export default function DashboardPage() {
	const { clearPendingPrompt } = useDashboardStore();

	// Clear any pending prompt when landing on this page
	useEffect(() => {
		clearPendingPrompt();
	}, [clearPendingPrompt]);

	// Show the new session creation empty state
	return <EmptyDashboard />;
}
