"use client";

export const dynamic = "force-dynamic";

import { CodingSession } from "@/components/coding-session/coding-session";
import { organization, useActiveOrganization } from "@/lib/auth-client";
import { useDashboardStore } from "@/stores/dashboard";
import { X, Zap } from "lucide-react";
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
	const runId = searchParams.get("runId");
	const fromAutomation = searchParams.get("from") === "automation";
	const [showAutomationBanner, setShowAutomationBanner] = useState(fromAutomation && !runId);
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
				window.location.replace(`/workspace/${id}?orgId=${targetOrgId}`);
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
		<div className="flex-1 min-h-0 flex flex-col">
			{showAutomationBanner && (
				<div className="flex items-center gap-2 px-4 py-2 bg-muted/60 border-b border-border text-sm text-muted-foreground shrink-0">
					<Zap className="h-3.5 w-3.5" />
					<span>Resumed from Automation</span>
					<button
						type="button"
						onClick={() => setShowAutomationBanner(false)}
						className="ml-auto text-muted-foreground/60 hover:text-foreground transition-colors"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			)}
			<div className="flex-1 min-h-0 flex flex-col">
				<CodingSession
					sessionId={id}
					runId={runId ?? undefined}
					initialPrompt={pendingPrompt || undefined}
					onError={(error) => {
						console.error("Session error:", error);
						clearPendingPrompt();
					}}
				/>
			</div>
		</div>
	);
}
