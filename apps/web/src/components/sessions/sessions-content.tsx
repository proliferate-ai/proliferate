"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { Input } from "@/components/ui/input";
import { useSessions } from "@/hooks/sessions/use-sessions";
import { cn } from "@/lib/display/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

interface SessionItem {
	id: string;
	state: string;
	initialPrompt: string | null;
	createdAt: Date;
	updatedAt: Date;
	endedAt: Date | null;
	repo: { githubOrg: string; githubName: string } | null;
}

function formatCompactTimeAgo(date: Date): string {
	const distance = formatDistanceToNowStrict(date);
	const [value, unit] = distance.split(" ");
	const unitKey = unit?.toLowerCase() ?? "";

	if (unitKey.startsWith("second")) return `${value}s ago`;
	if (unitKey.startsWith("minute")) return `${value}m ago`;
	if (unitKey.startsWith("hour")) return `${value}h ago`;
	if (unitKey.startsWith("day")) return `${value}d ago`;
	if (unitKey.startsWith("month")) return `${value}mo ago`;
	if (unitKey.startsWith("year")) return `${value}y ago`;
	return `${distance} ago`;
}

function getStateLabel(session: SessionItem): { label: string; className: string } {
	const state = session.state;

	if (state === "done" || session.endedAt) {
		return { label: "Done", className: "text-muted-foreground" };
	}
	if (state === "working") {
		return { label: "Working", className: "text-success" };
	}
	if (state === "idle") {
		return { label: "Idle", className: "text-muted-foreground" };
	}
	if (state === "cancelled") {
		return { label: "Cancelled", className: "text-muted-foreground" };
	}
	return { label: state ?? "Unknown", className: "text-muted-foreground" };
}

function SessionRow({ session }: { session: SessionItem }) {
	const displayTitle = session.initialPrompt || "Untitled";
	const repoName = session.repo ? session.repo.githubName : null;
	const timeAgo = formatCompactTimeAgo(new Date(session.updatedAt));
	const stateDisplay = getStateLabel(session);

	return (
		<div className="flex items-center px-4 py-2.5 border-b border-border/50 last:border-0 text-sm hover:bg-muted/50 transition-colors">
			{/* Status dot */}
			<div className="w-4 shrink-0 flex items-center justify-center">
				<div
					className={cn(
						"h-1.5 w-1.5 rounded-full",
						stateDisplay.label === "Working" ? "bg-success" : "bg-muted-foreground/40",
					)}
				/>
			</div>

			{/* Title */}
			<div className="flex-1 min-w-[140px] ml-1.5">
				<span className="font-medium text-foreground truncate block">{displayTitle}</span>
			</div>

			{/* Repo (hidden on mobile) */}
			<div className="w-28 shrink-0 hidden md:block">
				<span className="text-xs text-muted-foreground truncate block">{repoName || "\u2014"}</span>
			</div>

			{/* Status */}
			<div className="w-20 shrink-0">
				<span className={cn("text-xs font-medium", stateDisplay.className)}>
					{stateDisplay.label}
				</span>
			</div>

			{/* Time */}
			<div className="w-14 shrink-0 text-right">
				<span className="text-xs text-muted-foreground whitespace-nowrap">
					{timeAgo || "\u2014"}
				</span>
			</div>
		</div>
	);
}

export function SessionsContent() {
	const [searchQuery, setSearchQuery] = useState("");

	const { data: sessions, isLoading } = useSessions();

	const filteredSessions = useMemo(() => {
		if (!sessions) return [];
		const items = sessions as SessionItem[];
		if (!searchQuery) return items;
		const q = searchQuery.toLowerCase();
		return items.filter((s) => {
			const title = s.initialPrompt || "";
			const repo = s.repo ? `${s.repo.githubOrg}/${s.repo.githubName}` : "";
			return title.toLowerCase().includes(q) || repo.toLowerCase().includes(q);
		});
	}, [sessions, searchQuery]);

	return (
		<PageShell title="Sessions">
			{/* Search */}
			<div className="flex items-center justify-end gap-4 mb-4">
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
			) : filteredSessions.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<h2 className="text-sm font-medium text-foreground mb-1">
						{searchQuery ? "No matching sessions" : "No sessions yet"}
					</h2>
					{!searchQuery && (
						<p className="text-sm text-muted-foreground">
							Sessions will appear here once they are created.
						</p>
					)}
				</div>
			) : (
				<div className="rounded-lg border border-border bg-card overflow-hidden">
					<div className="hidden md:flex items-center px-4 py-1.5 border-b border-border/50 bg-muted/20 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						<span className="w-4 shrink-0" />
						<span className="flex-1 ml-1.5">Session</span>
						<span className="w-28 shrink-0">Repository</span>
						<span className="w-20 shrink-0">Status</span>
						<span className="w-14 shrink-0 text-right">Updated</span>
					</div>
					{filteredSessions.map((session) => (
						<SessionRow key={session.id} session={session} />
					))}
				</div>
			)}
		</PageShell>
	);
}
