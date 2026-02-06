"use client";

export const dynamic = "force-dynamic";

import { CodingSession } from "@/components/coding-session/coding-session";
import { organization, useActiveOrganization } from "@/lib/auth-client";
import { useDashboardStore } from "@/stores/dashboard";
import { useSearchParams } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";

export default function SessionDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const { setActiveSession, pendingPrompt, clearPendingPrompt } = useDashboardStore();
	const searchParams = useSearchParams();
	const targetOrgId = searchParams.get("orgId");
	const { data: activeOrg, isPending: isOrgPending } = useActiveOrganization();
	const [switchError, setSwitchError] = useState<string | null>(null);
	const [isSwitching, setIsSwitching] = useState(false);
	const shouldSwitchOrg = useMemo(
		() => Boolean(targetOrgId && activeOrg?.id && activeOrg.id !== targetOrgId),
		[targetOrgId, activeOrg?.id],
	);

	useEffect(() => {
		if (!targetOrgId || isOrgPending || isSwitching || !shouldSwitchOrg) return;
		setIsSwitching(true);
		organization
			.setActive({ organizationId: targetOrgId })
			.then(() => {
				window.location.replace(`/dashboard/sessions/${id}?orgId=${targetOrgId}`);
			})
			.catch((err) => {
				console.error("Failed to switch organization:", err);
				setSwitchError("Unable to switch organization for this session.");
				setIsSwitching(false);
			});
	}, [targetOrgId, isOrgPending, isSwitching, shouldSwitchOrg, id]);

	// Sync active session ID with URL
	useEffect(() => {
		setActiveSession(id);
	}, [id, setActiveSession]);

	if (targetOrgId && (isOrgPending || shouldSwitchOrg || isSwitching)) {
		return (
			<div className="h-full flex items-center justify-center text-sm text-muted-foreground">
				Switching organization...
			</div>
		);
	}

	if (switchError) {
		return (
			<div className="h-full flex items-center justify-center text-sm text-destructive">
				{switchError}
			</div>
		);
	}

	return (
		<div className="h-full">
			<CodingSession
				sessionId={id}
				initialPrompt={pendingPrompt || undefined}
				onError={(error) => {
					console.error("Session error:", error);
					clearPendingPrompt();
				}}
			/>
		</div>
	);
}
