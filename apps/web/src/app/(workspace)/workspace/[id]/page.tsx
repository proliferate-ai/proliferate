"use client";

export const dynamic = "force-dynamic";

import { CodingSession } from "@/components/coding-session/coding-session";
import { Button } from "@/components/ui/button";
import { useOrgSwitch } from "@/hooks/org/use-org-switch";
import { useMarkSessionViewed, useSessionData } from "@/hooks/sessions/use-sessions";
import { buildWorkspaceRedirectUrl } from "@/lib/display/urls";
import { useDashboardStore } from "@/stores/dashboard";
import { X, Zap } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";

export default function SessionDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const setActiveSession = useDashboardStore((state) => state.setActiveSession);
	const pendingPrompt = useDashboardStore((state) => state.pendingPrompt);
	const clearPendingPrompt = useDashboardStore((state) => state.clearPendingPrompt);
	const { data: sessionData } = useSessionData(id);
	useMarkSessionViewed(id);
	const searchParams = useSearchParams();
	const targetOrgId = searchParams.get("orgId");
	const runId = searchParams.get("runId");
	const fromCoworker = searchParams.get("from") === "coworker";
	const [showCoworkerBanner, setShowCoworkerBanner] = useState(fromCoworker && !runId);

	const buildRedirectUrl = useCallback(
		(orgId: string) => buildWorkspaceRedirectUrl(id, orgId, runId),
		[id, runId],
	);

	const { isSwitching, isOrgPending, shouldSwitchOrg, switchError } = useOrgSwitch({
		targetOrgId,
		buildRedirectUrl,
	});

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
			{showCoworkerBanner && (
				<div className="flex items-center gap-2 px-4 py-2 bg-muted/60 border-b border-border text-sm text-muted-foreground shrink-0">
					<Zap className="h-3.5 w-3.5" />
					<span>Resumed from Coworker</span>
					<Button
						variant="ghost"
						onClick={() => setShowCoworkerBanner(false)}
						className="ml-auto h-auto p-0 text-muted-foreground/60 hover:text-foreground transition-colors"
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>
			)}
			<div className="flex-1 min-h-0 flex flex-col">
				<CodingSession
					sessionId={id}
					runId={runId ?? undefined}
					initialPrompt={pendingPrompt || sessionData?.initialPrompt || undefined}
					onError={() => {
						clearPendingPrompt();
					}}
				/>
			</div>
		</div>
	);
}
