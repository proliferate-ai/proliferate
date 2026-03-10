"use client";

import { LoadingDots } from "@/components/ui/loading-dots";
import { useLatestSetupSession } from "@/hooks/sessions/use-baselines";
import { formatDateWithYear } from "@/lib/display/format";

export function SetupRunSection({ repoId }: { repoId: string }) {
	const { data: latestSession, isLoading } = useLatestSetupSession(repoId);

	if (isLoading) {
		return (
			<section>
				<h2 className="text-sm font-medium mb-3">Latest Setup Run</h2>
				<LoadingDots size="sm" className="text-muted-foreground" />
			</section>
		);
	}

	if (!latestSession) {
		return (
			<section>
				<h2 className="text-sm font-medium mb-3">Latest Setup Run</h2>
				<div className="rounded-lg border border-dashed border-border/80 py-6 text-center">
					<p className="text-sm text-muted-foreground">No setup runs yet</p>
				</div>
			</section>
		);
	}

	return (
		<section>
			<h2 className="text-sm font-medium mb-3">Latest Setup Run</h2>
			<div className="rounded-lg border border-border/80 bg-background p-4">
				<div className="flex items-center justify-between text-xs">
					<div className="flex items-center gap-3">
						<span className="font-medium">Session</span>
						<span className="text-muted-foreground">
							{latestSession.terminalState ?? latestSession.agentState}
						</span>
					</div>
					<span className="text-muted-foreground">
						{formatDateWithYear(latestSession.startedAt)}
					</span>
				</div>
			</div>
		</section>
	);
}
