"use client";

import { useCreatePrebuild } from "@/hooks/use-prebuilds";
import { useCreateSession } from "@/hooks/use-sessions";
import { cn, getRepoShortName } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import type { Repo, Session } from "@proliferate/shared/contracts";
import { ChevronRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SessionItem } from "./session-item";

export interface RepoGroupSessionItem {
	session: Session;
	environmentName?: string | null;
}

interface RepoGroupProps {
	repo: Repo;
	sessions: RepoGroupSessionItem[];
	defaultPrebuildId: string | null;
	activeSessionId: string | null | undefined;
	onNavigate?: () => void;
}

export function RepoGroup({
	repo,
	sessions,
	defaultPrebuildId,
	activeSessionId,
	onNavigate,
}: RepoGroupProps) {
	const [isOpen, setIsOpen] = useState(sessions.length > 0);
	const router = useRouter();

	const createPrebuild = useCreatePrebuild();
	const createSession = useCreateSession();
	const { selectedModel, setActiveSession, clearPendingPrompt } = useDashboardStore();

	const repoShortName = getRepoShortName(repo.githubRepoName);

	const handleCreateSession = async () => {
		if (createPrebuild.isPending || createSession.isPending) return;

		try {
			let prebuildId = defaultPrebuildId;
			if (!prebuildId) {
				const created = await createPrebuild.mutateAsync({
					repoIds: [repo.id],
					name: repoShortName,
				});
				prebuildId = created.prebuildId;
			}

			const result = await createSession.mutateAsync({
				prebuildId,
				sessionType: "coding",
				modelId: selectedModel,
			});

			clearPendingPrompt();
			setActiveSession(result.sessionId);
			router.push(`/dashboard/sessions/${result.sessionId}`);
			onNavigate?.();
		} catch (error) {
			console.error("Failed to create session:", error);
		}
	};

	return (
		<div className="mt-0.5">
			{/* Group header */}
			<div
				onClick={() => setIsOpen(!isOpen)}
				className="group relative flex items-center gap-[0.38rem] px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors text-muted-foreground hover:text-foreground hover:bg-accent"
			>
				<ChevronRight
					className={cn(
						"h-3.5 w-3.5 shrink-0 transition-transform duration-200",
						isOpen && "rotate-90",
					)}
				/>

				<div className="flex-1 min-w-0 flex items-center">
					<span className="truncate" title={repo.githubRepoName}>
						{repoShortName}
					</span>
				</div>

				<div className="shrink-0 flex items-center">
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							handleCreateSession();
						}}
						disabled={createPrebuild.isPending || createSession.isPending}
						className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
						title="New session"
					>
						<Plus className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{/* Child sessions */}
			<div
				className={cn(
					"overflow-hidden transition-all duration-200",
					isOpen ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0",
				)}
			>
				{sessions.length > 0 ? (
					sessions.map(({ session, environmentName }) => (
						<SessionItem
							key={session.id}
							session={session}
							isActive={activeSessionId === session.id}
							onNavigate={onNavigate}
							secondaryLabel={environmentName ?? undefined}
						/>
					))
				) : (
					<div className="pl-7 pr-3 py-1.5 text-xs text-muted-foreground/60">No sessions</div>
				)}
			</div>
		</div>
	);
}
