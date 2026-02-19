"use client";

export const dynamic = "force-dynamic";

import { EmptyDashboard } from "@/components/dashboard/empty-state";
import { WelcomeDialog } from "@/components/dashboard/welcome-dialog";
import { useDashboardStore } from "@/stores/dashboard";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect } from "react";

function DashboardContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { clearPendingPrompt } = useDashboardStore();

	// Check for ?joined=OrgName param (set after accepting an invitation)
	const joinedOrgName = searchParams.get("joined");

	// Clear any pending prompt when landing on this page
	useEffect(() => {
		clearPendingPrompt();
	}, [clearPendingPrompt]);

	const handleJoinedDismiss = useCallback(() => {
		// Remove the ?joined param from the URL without navigation
		router.replace("/dashboard");
	}, [router]);

	return (
		<>
			<WelcomeDialog
				joinedOrgName={joinedOrgName ?? undefined}
				onJoinedDismiss={handleJoinedDismiss}
			/>
			<EmptyDashboard />
		</>
	);
}

export default function DashboardPage() {
	return (
		<Suspense fallback={null}>
			<DashboardContent />
		</Suspense>
	);
}
