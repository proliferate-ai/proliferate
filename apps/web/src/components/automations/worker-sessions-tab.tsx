"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/display/utils";
import { formatRelativeTime } from "@/lib/display/utils";
import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export interface WorkerSession {
	id: string;
	title: string | null;
	status: string;
	repoId: string | null;
	branchName: string | null;
	agentState: string | null;
	terminalState: string | null;
	updatedAt: string;
	startedAt: string | null;
}

type SessionFilter = "all" | "in_progress" | "completed" | "failed";

const SESSION_FILTERS: { value: SessionFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "in_progress", label: "In Progress" },
	{ value: "completed", label: "Completed" },
	{ value: "failed", label: "Failed" },
];

interface WorkerSessionsTabProps {
	sessions: WorkerSession[];
	isLoading: boolean;
}

function sessionStatusDot(status: string): "active" | "paused" | "stopped" | "error" {
	switch (status) {
		case "running":
		case "starting":
			return "active";
		case "paused":
			return "paused";
		case "completed":
			return "stopped";
		case "failed":
		case "cancelled":
			return "error";
		default:
			return "stopped";
	}
}

function matchesFilter(session: WorkerSession, filter: SessionFilter): boolean {
	if (filter === "all") return true;
	if (filter === "in_progress") {
		return ["running", "starting", "paused", "queued"].includes(session.status);
	}
	if (filter === "completed") return session.status === "completed";
	if (filter === "failed") return ["failed", "cancelled"].includes(session.status);
	return true;
}

function matchesSearch(session: WorkerSession, query: string): boolean {
	if (!query) return true;
	const q = query.toLowerCase();
	if (session.title?.toLowerCase().includes(q)) return true;
	if (session.branchName?.toLowerCase().includes(q)) return true;
	return false;
}

export function WorkerSessionsTab({ sessions, isLoading }: WorkerSessionsTabProps) {
	const [filter, setFilter] = useState<SessionFilter>("all");
	const [search, setSearch] = useState("");

	const filtered = useMemo(() => {
		return sessions.filter((s) => matchesFilter(s, filter) && matchesSearch(s, search));
	}, [sessions, filter, search]);

	const counts = useMemo(() => {
		return {
			all: sessions.length,
			in_progress: sessions.filter((s) => matchesFilter(s, "in_progress")).length,
			completed: sessions.filter((s) => matchesFilter(s, "completed")).length,
			failed: sessions.filter((s) => matchesFilter(s, "failed")).length,
		};
	}, [sessions]);

	if (isLoading) {
		return (
			<div className="rounded-lg border border-border overflow-hidden">
				{[1, 2, 3].map((i) => (
					<div
						key={i}
						className="h-12 border-b border-border/50 last:border-0 animate-pulse bg-muted/30"
					/>
				))}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Filters bar */}
			<div className="flex items-center gap-3">
				<div className="flex items-center gap-1">
					{SESSION_FILTERS.map((f) => (
						<Button
							key={f.value}
							variant="ghost"
							size="sm"
							onClick={() => setFilter(f.value)}
							className={cn(
								"h-7 px-2.5 text-xs font-medium rounded-md transition-colors",
								filter === f.value
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
							)}
						>
							{f.label}
							<span className="ml-1.5 text-muted-foreground tabular-nums">{counts[f.value]}</span>
						</Button>
					))}
				</div>
				<div className="relative flex-1 max-w-xs ml-auto">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
					<Input
						placeholder="Search sessions..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="h-7 pl-8 text-xs"
					/>
				</div>
			</div>

			{/* Session list */}
			{filtered.length === 0 ? (
				<div className="text-center py-8 rounded-lg border border-border">
					<p className="text-sm text-muted-foreground">
						{sessions.length === 0 ? "No task sessions yet" : "No sessions match your filters"}
					</p>
				</div>
			) : (
				<div className="rounded-lg border border-border overflow-hidden">
					{/* Header */}
					<div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
						<div className="flex-1 min-w-0">Session</div>
						<div className="hidden md:block w-20 shrink-0">Status</div>
						<div className="hidden md:block w-32 shrink-0">Branch</div>
						<div className="w-20 shrink-0 text-right">Updated</div>
					</div>

					{filtered.map((session) => (
						<Link
							key={session.id}
							href={`/workspace/${session.id}`}
							className="group flex items-center gap-4 px-4 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm last:border-0"
						>
							{/* Title */}
							<div className="flex items-center gap-2.5 min-w-0 flex-1">
								<StatusDot
									status={sessionStatusDot(session.status)}
									size="sm"
									className="shrink-0"
								/>
								<span className="text-foreground truncate group-hover:text-primary transition-colors">
									{session.title || "Untitled session"}
								</span>
							</div>

							{/* Status */}
							<div className="hidden md:block w-20 shrink-0">
								<span className="text-xs text-muted-foreground capitalize">{session.status}</span>
							</div>

							{/* Branch */}
							<div className="hidden md:block w-32 shrink-0">
								<span className="text-xs text-muted-foreground truncate">
									{session.branchName || "—"}
								</span>
							</div>

							{/* Updated */}
							<div className="w-20 shrink-0 text-right">
								<span className="text-xs text-muted-foreground">
									{formatRelativeTime(session.updatedAt)}
								</span>
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
