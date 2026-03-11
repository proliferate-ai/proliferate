"use client";

import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useLatestSetupSession } from "@/hooks/sessions/use-baselines";
import { formatDateWithYear } from "@/lib/display/format";
import Link from "next/link";

function isSessionActive(session: { sandboxState: string; terminalState: string | null }): boolean {
	if (session.terminalState) return false;
	return session.sandboxState === "running" || session.sandboxState === "provisioning";
}

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
					<Button size="sm" className="mt-3" asChild>
						<Link href={`/workspace/onboard?repo=${repoId}`}>Start Setup</Link>
					</Button>
				</div>
			</section>
		);
	}

	const active = isSessionActive(latestSession);

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
						<span className="text-muted-foreground">
							{formatDateWithYear(latestSession.startedAt)}
						</span>
					</div>
					<div className="flex items-center gap-2">
						{active && (
							<Button variant="outline" size="sm" className="h-7 text-xs" asChild>
								<Link href={`/session/${latestSession.id}`}>Continue</Link>
							</Button>
						)}
						<Button variant="outline" size="sm" className="h-7 text-xs" asChild>
							<Link href={`/workspace/onboard?repo=${repoId}`}>New Setup</Link>
						</Button>
					</div>
				</div>
			</div>
		</section>
	);
}
