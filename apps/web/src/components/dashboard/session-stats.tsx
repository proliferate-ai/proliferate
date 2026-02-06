"use client";

import { useSessions } from "@/hooks/use-sessions";
import { Activity, Clock, GitCommit } from "lucide-react";

export function SessionStats() {
	const { data: sessions } = useSessions();

	// Calculate stats
	const now = new Date();
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	const recentSessions =
		sessions?.filter((s) => s.startedAt && new Date(s.startedAt) >= weekAgo) || [];
	const activeSessions = sessions?.filter((s) => s.status === "running") || [];
	const totalSessions = sessions?.length || 0;

	const stats = [
		{
			label: "Sessions this week",
			value: recentSessions.length,
			icon: Activity,
		},
		{
			label: "Active now",
			value: activeSessions.length,
			icon: Clock,
		},
		{
			label: "Total sessions",
			value: totalSessions,
			icon: GitCommit,
		},
	];

	return (
		<div className="hidden md:grid grid-cols-3 gap-4 max-w-2xl mx-auto">
			{stats.map((stat) => (
				<div key={stat.label} className="p-4 rounded-lg border border-border bg-card">
					<div className="flex items-center gap-2 text-muted-foreground mb-2">
						<stat.icon className="h-4 w-4" />
						<span className="text-xs">{stat.label}</span>
					</div>
					<p className="text-2xl font-semibold">{stat.value}</p>
				</div>
			))}
		</div>
	);
}
