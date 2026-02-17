"use client";

import { SessionCard } from "@/components/sessions/session-card";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useSessions } from "@/hooks/use-sessions";
import { useDashboardStore } from "@/stores/dashboard";
import { MessageSquare, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

export default function SessionsPage() {
	const router = useRouter();
	const { setActiveSession, clearPendingPrompt } = useDashboardStore();

	// Fetch sessions
	const { data: sessions, isLoading } = useSessions();

	// Filter out setup sessions and CLI sessions
	const filteredSessions = sessions?.filter(
		(session) => session.sessionType !== "setup" && session.origin !== "cli",
	);

	const handleNewSession = () => {
		clearPendingPrompt();
		setActiveSession(null);
		router.push("/dashboard");
	};

	return (
		<div className="flex-1 p-6">
			{/* Header */}
			<div className="flex items-center justify-between mb-6">
				<div className="flex items-center gap-2">
					<MessageSquare className="h-5 w-5 text-primary" />
					<Text variant="h4">Sessions</Text>
				</div>
				<Button onClick={handleNewSession} size="sm">
					<Plus className="h-4 w-4 mr-1" />
					New
				</Button>
			</div>

			{/* Content */}
			{isLoading ? (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div key={i} className="h-24 rounded-lg bg-muted/50 animate-pulse" />
					))}
				</div>
			) : filteredSessions && filteredSessions.length > 0 ? (
				<div className="space-y-3">
					{filteredSessions.map((session) => (
						<SessionCard key={session.id} session={session} />
					))}
				</div>
			) : (
				<div className="text-center py-12">
					<MessageSquare className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
					<Text variant="h4" className="mb-2">
						No sessions yet
					</Text>
					<Text variant="body" color="muted" className="mb-4">
						Start a new coding session to work with an AI agent on your codebase.
					</Text>
					<Button onClick={handleNewSession}>
						<Plus className="h-4 w-4 mr-2" />
						New Session
					</Button>
				</div>
			)}
		</div>
	);
}
