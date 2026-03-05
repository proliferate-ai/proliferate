"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { SessionListRow } from "@/components/sessions/session-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { type FilterTab, type OriginFilter, TABS } from "@/config/sessions";
import { useOrgPendingRuns } from "@/hooks/automations/use-automations";
import { useSessionListState } from "@/hooks/sessions/use-overall-work-state";
import { useSessions } from "@/hooks/sessions/use-sessions";
import { cn } from "@/lib/display/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function SessionsContent() {
	const router = useRouter();
	const { setActiveSession, clearPendingPrompt } = useDashboardStore();
	const [activeTab, setActiveTab] = useState<FilterTab>("in_progress");
	const [searchQuery, setSearchQuery] = useState("");
	const [originFilter, setOriginFilter] = useState<OriginFilter>("all");

	// Track whether visible sessions include live ones (for polling).
	const [hasLiveSessions, setHasLiveSessions] = useState(false);

	const { data: sessions, isLoading } = useSessions({
		excludeSetup: true,
		refetchInterval: hasLiveSessions ? 5000 : false,
	});

	const { data: pendingRuns } = useOrgPendingRuns();
	const { pendingRunsBySession, result } = useSessionListState({
		sessions,
		activeTab,
		searchQuery,
		originFilter,
		automationOriginValue: "coworker",
		pendingRuns,
	});

	// Sync polling state outside of useMemo to avoid side-effects during render
	useEffect(() => {
		setHasLiveSessions(result.visibleHasLive);
	}, [result.visibleHasLive]);

	const handleNewSession = () => {
		clearPendingPrompt();
		setActiveSession(null);
		router.push("/dashboard");
	};

	return (
		<PageShell
			title="Sessions"
			actions={
				<Button onClick={handleNewSession} size="sm">
					<Plus className="h-4 w-4 mr-1" />
					New
				</Button>
			}
		>
			{/* Filter tabs + search + origin filter */}
			<div className="flex items-center justify-between gap-4 mb-4">
				<div className="flex items-center gap-1">
					{TABS.map((tab) => (
						<Button
							key={tab.value}
							variant="ghost"
							onClick={() => setActiveTab(tab.value)}
							className={cn(
								"px-3 py-1.5 h-auto text-sm font-medium rounded-md transition-colors",
								activeTab === tab.value
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
							)}
						>
							{tab.label}
							<span className="ml-1.5 text-xs text-muted-foreground">
								{result.counts[tab.value]}
							</span>
						</Button>
					))}
				</div>
				<div className="flex items-center gap-2">
					<Select value={originFilter} onValueChange={(v) => setOriginFilter(v as OriginFilter)}>
						<SelectTrigger className="h-8 w-[130px] text-sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Origins</SelectItem>
							<SelectItem value="manual">Manual</SelectItem>
							<SelectItem value="coworker">Coworker</SelectItem>
							<SelectItem value="slack">Slack</SelectItem>
							<SelectItem value="cli">CLI</SelectItem>
						</SelectContent>
					</Select>
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
						<Input
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search sessions..."
							className="h-8 w-48 pl-8 text-sm"
						/>
					</div>
				</div>
			</div>

			{/* Content */}
			{isLoading ? (
				<div className="rounded-lg border border-border bg-card overflow-hidden">
					{[1, 2, 3, 4, 5].map((i) => (
						<div
							key={i}
							className="flex items-center px-4 py-2.5 border-b border-border/50 last:border-0 gap-3 animate-pulse"
						>
							<div className="h-1.5 w-1.5 rounded-full bg-muted flex-shrink-0" />
							<div
								className="h-4 rounded bg-muted"
								style={{ width: `${120 + ((i * 47) % 140)}px` }}
							/>
							<div className="flex-1" />
							<div className="h-3 w-20 rounded bg-muted" />
							<div className="h-5 w-16 rounded-md bg-muted" />
						</div>
					))}
				</div>
			) : result.totalCount === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<h2 className="text-sm font-medium text-foreground mb-1">No sessions yet</h2>
					<p className="text-sm text-muted-foreground mb-4">
						Start a new coding session to work with an AI agent on your codebase.
					</p>
					<Button onClick={handleNewSession} size="sm">
						<Plus className="h-4 w-4 mr-1" />
						New Session
					</Button>
				</div>
			) : result.filtered.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<p className="text-sm text-muted-foreground">No matching sessions</p>
				</div>
			) : (
				<div className="rounded-lg border border-border bg-card overflow-hidden">
					<div className="hidden md:flex items-center px-4 py-1.5 border-b border-border/50 bg-muted/20 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						<span className="flex-1">Session</span>
						<span className="w-28 shrink-0">Configuration</span>
					</div>
					{result.filtered.map((session) => (
						<SessionListRow
							key={session.id}
							session={session}
							pendingRun={pendingRunsBySession.get(session.id)}
						/>
					))}
				</div>
			)}
		</PageShell>
	);
}
