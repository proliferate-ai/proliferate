"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { SessionListRow } from "@/components/sessions/session-card";
import { SessionPeekDrawer } from "@/components/sessions/session-peek-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { CreatorFilter, FilterTab, OriginFilter } from "@/config/sessions";
import {
	IN_PROGRESS_STATUSES,
	LIVE_STATUSES,
	NEEDS_ATTENTION_STATUSES,
	TABS,
} from "@/config/sessions";
import { useOrgPendingRuns } from "@/hooks/use-automations";
import { useSessions } from "@/hooks/use-sessions";
import { useSession } from "@/lib/auth/client";
import { getSessionOrigin, sortSessions } from "@/lib/sessions/filters";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { deriveDisplayStatus } from "@proliferate/shared/sessions";
import { Plus, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

interface OriginOption {
	value: OriginFilter;
	label: string;
}

export interface SessionsListProps {
	automationOriginValue: OriginFilter;
	originOptions: OriginOption[];
	newSessionPath: string;
	showCreatorFilter?: boolean;
	enableSorting?: boolean;
	tableHeader?: ReactNode;
}

export function SessionsList({
	automationOriginValue,
	originOptions,
	newSessionPath,
	showCreatorFilter = false,
	enableSorting = false,
	tableHeader,
}: SessionsListProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { setActiveSession, clearPendingPrompt } = useDashboardStore();
	const { data: authSession } = useSession();
	const [activeTab, setActiveTab] = useState<FilterTab>("in_progress");
	const [searchQuery, setSearchQuery] = useState("");
	const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
	const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>("all");

	const currentUserId = authSession?.user?.id;

	const peekSessionId = searchParams.get("peek");

	const handleRowClick = (sessionId: string) => {
		const params = new URLSearchParams(searchParams.toString());
		params.set("peek", sessionId);
		router.replace(`?${params.toString()}`, { scroll: false });
	};

	const handlePeekClose = () => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("peek");
		router.replace(`?${params.toString()}`, { scroll: false });
	};

	const [hasLiveSessions, setHasLiveSessions] = useState(false);

	const { data: sessions, isLoading } = useSessions({
		excludeSetup: true,
		refetchInterval: hasLiveSessions ? 5000 : false,
	});

	const { data: pendingRuns } = useOrgPendingRuns();

	const pendingRunsBySession = useMemo(() => {
		const map = new Map<string, NonNullable<typeof pendingRuns>[number]>();
		if (!pendingRuns) return map;
		for (const run of pendingRuns) {
			if (run.session_id && !map.has(run.session_id)) {
				map.set(run.session_id, run);
			}
		}
		return map;
	}, [pendingRuns]);

	const result = useMemo(() => {
		const baseSessions = sessions?.filter((s) => !s.kind || s.kind === "task") ?? [];

		const withStatus = baseSessions.map((s) => ({
			session: s,
			displayStatus: deriveDisplayStatus(s.status, s.pauseReason),
			origin: getSessionOrigin(s, automationOriginValue),
		}));

		// Apply creator filter (only if enabled)
		const creatorFiltered =
			showCreatorFilter && creatorFilter !== "all" && currentUserId
				? withStatus.filter((s) => s.session.createdBy === currentUserId)
				: withStatus;

		const originFiltered =
			originFilter === "all"
				? creatorFiltered
				: creatorFiltered.filter((s) => s.origin === originFilter);

		const tabCounts = {
			in_progress: 0,
			needs_attention: 0,
			paused: 0,
			completed: 0,
		};

		for (const { session, displayStatus } of originFiltered) {
			if (IN_PROGRESS_STATUSES.has(displayStatus)) {
				tabCounts.in_progress++;
			} else if (
				NEEDS_ATTENTION_STATUSES.has(displayStatus) ||
				pendingRunsBySession.has(session.id)
			) {
				tabCounts.needs_attention++;
			} else if (displayStatus === "paused") {
				tabCounts.paused++;
			} else {
				tabCounts.completed++;
			}
		}

		let tabFiltered = originFiltered;
		switch (activeTab) {
			case "in_progress":
				tabFiltered = originFiltered.filter((s) => IN_PROGRESS_STATUSES.has(s.displayStatus));
				break;
			case "needs_attention":
				tabFiltered = originFiltered.filter(
					(s) =>
						NEEDS_ATTENTION_STATUSES.has(s.displayStatus) || pendingRunsBySession.has(s.session.id),
				);
				break;
			case "paused":
				tabFiltered = originFiltered.filter((s) => s.displayStatus === "paused");
				break;
			case "completed":
				tabFiltered = originFiltered.filter((s) => s.displayStatus === "completed");
				break;
		}

		let finalFiltered = tabFiltered;
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			finalFiltered = tabFiltered.filter(({ session: s }) => {
				const title = s.title?.toLowerCase() ?? "";
				const repo = s.repo?.githubRepoName?.toLowerCase() ?? "";
				const branch = s.branchName?.toLowerCase() ?? "";
				const automationName = s.automation?.name?.toLowerCase() ?? "";
				const snippet = s.promptSnippet?.toLowerCase() ?? "";
				return (
					title.includes(q) ||
					repo.includes(q) ||
					branch.includes(q) ||
					automationName.includes(q) ||
					snippet.includes(q)
				);
			});
		}

		const sorted = enableSorting ? sortSessions(finalFiltered) : finalFiltered;

		return {
			filtered: sorted.map((s) => s.session),
			counts: tabCounts,
			totalCount: baseSessions.length,
			visibleHasLive: finalFiltered.some((s) => LIVE_STATUSES.has(s.displayStatus)),
		};
	}, [
		sessions,
		activeTab,
		searchQuery,
		originFilter,
		creatorFilter,
		currentUserId,
		pendingRunsBySession,
		automationOriginValue,
		showCreatorFilter,
		enableSorting,
	]);

	useEffect(() => {
		setHasLiveSessions(result.visibleHasLive);
	}, [result.visibleHasLive]);

	const handleNewSession = () => {
		clearPendingPrompt();
		setActiveSession(null);
		router.push(newSessionPath);
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
			{/* Filter tabs + search + filters */}
			<div className="flex flex-col gap-3 mb-4">
				<div className="flex items-center justify-between gap-4">
					<div className="flex items-center gap-1">
						{TABS.map((tab) => (
							<Button
								key={tab.value}
								variant="ghost"
								size="sm"
								onClick={() => setActiveTab(tab.value)}
								className={cn(
									"px-3 py-1.5 text-sm font-medium rounded-md",
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
						{showCreatorFilter && (
							<div className="flex items-center rounded-md border border-border/50 overflow-hidden">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setCreatorFilter("all")}
									className={cn(
										"px-2.5 py-1 text-xs font-medium rounded-none h-auto",
										creatorFilter === "all"
											? "bg-muted text-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									All
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setCreatorFilter("mine")}
									className={cn(
										"px-2.5 py-1 text-xs font-medium rounded-none h-auto",
										creatorFilter === "mine"
											? "bg-muted text-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									Mine
								</Button>
							</div>
						)}
						<Select value={originFilter} onValueChange={(v) => setOriginFilter(v as OriginFilter)}>
							<SelectTrigger className="h-8 w-[130px] text-sm">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{originOptions.map((opt) => (
									<SelectItem key={opt.value} value={opt.value}>
										{opt.label}
									</SelectItem>
								))}
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
			</div>

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
					{tableHeader}
					{result.filtered.map((session) => (
						<SessionListRow
							key={session.id}
							session={session}
							pendingRun={pendingRunsBySession.get(session.id)}
							onClick={handleRowClick}
						/>
					))}
				</div>
			)}

			<SessionPeekDrawer
				sessionId={peekSessionId}
				pendingRunId={peekSessionId ? pendingRunsBySession.get(peekSessionId)?.id : undefined}
				onClose={handlePeekClose}
			/>
		</PageShell>
	);
}
