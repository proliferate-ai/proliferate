"use client";

import { Button } from "@/components/ui/button";
import { useSessions } from "@/hooks/use-sessions";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import type { Session } from "@proliferate/shared/contracts";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";

function groupSessionsByDate(sessions: Session[]) {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

	const groups: { label: string; sessions: Session[] }[] = [
		{ label: "Today", sessions: [] },
		{ label: "Previous 7 Days", sessions: [] },
		{ label: "Older", sessions: [] },
	];

	for (const session of sessions) {
		const date = new Date(session.lastActivityAt ?? session.startedAt ?? "");
		if (date >= today) {
			groups[0].sessions.push(session);
		} else if (date >= weekAgo) {
			groups[1].sessions.push(session);
		} else {
			groups[2].sessions.push(session);
		}
	}

	return groups.filter((g) => g.sessions.length > 0);
}

export function StudioSidebar() {
	const params = useParams<{ id: string }>();
	const activeId = params.id;
	const { data: sessions, isLoading } = useSessions();
	const { setCommandSearchOpen } = useDashboardStore();

	const sorted = useMemo(
		() =>
			[...(sessions ?? [])].sort((a, b) => {
				const aDate = a.lastActivityAt ?? a.startedAt ?? "";
				const bDate = b.lastActivityAt ?? b.startedAt ?? "";
				return bDate.localeCompare(aDate);
			}),
		[sessions],
	);

	const groups = useMemo(() => groupSessionsByDate(sorted), [sorted]);

	return (
		<aside className="hidden md:flex w-56 flex-col border-r border-border bg-sidebar shrink-0 h-full">
			{/* New session + Search */}
			<div className="p-2 space-y-1">
				<Link href="/workspace" className="block">
					<Button variant="default" size="sm" className="w-full h-8 gap-1.5 text-xs justify-start">
						<Plus className="h-3.5 w-3.5" />
						New session
					</Button>
				</Link>
				<Button
					variant="ghost"
					size="sm"
					className="w-full h-8 gap-1.5 text-xs justify-start text-muted-foreground"
					onClick={() => setCommandSearchOpen(true)}
				>
					<Search className="h-3.5 w-3.5" />
					Search
					<kbd className="ml-auto text-[10px] px-1 py-0.5 rounded border border-border">⌘K</kbd>
				</Button>
			</div>

			{/* Session list */}
			<nav className="flex-1 overflow-y-auto px-2 py-1">
				{isLoading ? (
					<div className="space-y-2 px-2 py-1">
						{[1, 2, 3].map((i) => (
							<div key={i} className="h-8 rounded-md animate-pulse bg-muted" />
						))}
					</div>
				) : groups.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-center">
						<MessageSquare className="h-5 w-5 text-muted-foreground/30 mb-2" />
						<p className="text-xs text-muted-foreground">No sessions yet</p>
					</div>
				) : (
					groups.map((group) => (
						<div key={group.label} className="mb-3">
							<p className="px-2 py-1 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
								{group.label}
							</p>
							<div className="space-y-0.5">
								{group.sessions.map((session) => {
									const isActive = session.id === activeId;
									const timeAgo = session.lastActivityAt
										? formatDistanceToNow(new Date(session.lastActivityAt), {
												addSuffix: true,
											})
										: null;

									return (
										<Link
											key={session.id}
											href={`/workspace/${session.id}`}
											className={cn(
												"flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors group",
												isActive
													? "bg-muted/80 text-foreground"
													: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
											)}
										>
											<div className="flex-1 min-w-0">
												<p className="text-xs truncate">{session.title || "Untitled session"}</p>
												{timeAgo && (
													<p className="text-[10px] text-muted-foreground/60 truncate">{timeAgo}</p>
												)}
											</div>
											{session.status === "running" && (
												<span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
											)}
										</Link>
									);
								})}
							</div>
						</div>
					))
				)}
			</nav>
		</aside>
	);
}
