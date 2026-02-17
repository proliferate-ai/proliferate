"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { SessionListRow } from "@/components/sessions/session-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSessions } from "@/hooks/use-sessions";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type FilterTab = "all" | "active" | "stopped";

const TABS: { value: FilterTab; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "active", label: "Active" },
	{ value: "stopped", label: "Stopped" },
];

function isActiveStatus(status: string | null): boolean {
	return status === "running" || status === "starting" || status === "paused";
}

export default function SessionsPage() {
	const router = useRouter();
	const { setActiveSession, clearPendingPrompt } = useDashboardStore();
	const { data: sessions, isLoading } = useSessions();

	const [activeTab, setActiveTab] = useState<FilterTab>("all");
	const [searchQuery, setSearchQuery] = useState("");

	// Filter out setup sessions and CLI sessions
	const baseSessions = useMemo(
		() =>
			sessions?.filter((session) => session.sessionType !== "setup" && session.origin !== "cli") ??
			[],
		[sessions],
	);

	const counts = useMemo(
		() => ({
			all: baseSessions.length,
			active: baseSessions.filter((s) => isActiveStatus(s.status)).length,
			stopped: baseSessions.filter((s) => !isActiveStatus(s.status)).length,
		}),
		[baseSessions],
	);

	const filtered = useMemo(() => {
		let result = baseSessions;

		if (activeTab === "active") {
			result = result.filter((s) => isActiveStatus(s.status));
		} else if (activeTab === "stopped") {
			result = result.filter((s) => !isActiveStatus(s.status));
		}

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			result = result.filter((s) => {
				const title = s.title?.toLowerCase() ?? "";
				const repo = s.repo?.githubRepoName?.toLowerCase() ?? "";
				const branch = s.branchName?.toLowerCase() ?? "";
				return title.includes(q) || repo.includes(q) || branch.includes(q);
			});
		}

		return result;
	}, [baseSessions, activeTab, searchQuery]);

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
			{/* Filter tabs + search */}
			<div className="flex items-center justify-between gap-4 mb-4">
				<div className="flex items-center gap-1">
					{TABS.map((tab) => (
						<button
							key={tab.value}
							type="button"
							onClick={() => setActiveTab(tab.value)}
							className={cn(
								"px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
								activeTab === tab.value
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
							)}
						>
							{tab.label}
							<span className="ml-1.5 text-xs text-muted-foreground">{counts[tab.value]}</span>
						</button>
					))}
				</div>
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
			) : baseSessions.length === 0 ? (
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
			) : filtered.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<p className="text-sm text-muted-foreground">No matching sessions</p>
				</div>
			) : (
				<div className="rounded-lg border border-border bg-card overflow-hidden">
					{filtered.map((session) => (
						<SessionListRow key={session.id} session={session} />
					))}
				</div>
			)}
		</PageShell>
	);
}
