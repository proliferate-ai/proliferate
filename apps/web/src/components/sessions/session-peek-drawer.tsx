"use client";

import { Button } from "@/components/ui/button";
import { BlocksIcon, BlocksLoadingIcon } from "@/components/ui/icons";
import { SanitizedMarkdown } from "@/components/ui/sanitized-markdown";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { useSessionData } from "@/hooks/use-sessions";
import {
	DISPLAY_STATUS_CONFIG,
	formatActiveTime,
	getOutcomeDisplay,
	isHttpsUrl,
	parsePrUrl,
} from "@/lib/session-display";
import { cn } from "@/lib/utils";
import type { Session } from "@proliferate/shared/contracts";
import { deriveDisplayStatus, getBlockedReasonText } from "@proliferate/shared/sessions";
import { formatDistanceToNow } from "date-fns";
import {
	AlertTriangle,
	ArrowRight,
	ExternalLink,
	GitBranch,
	GitPullRequest,
	RotateCcw,
	Wrench,
	X,
} from "lucide-react";
import { useRouter } from "next/navigation";

interface SessionPeekDrawerProps {
	sessionId: string | null;
	pendingRunId?: string | null;
	onClose: () => void;
}

function StatusBadge({ session }: { session: Session }) {
	const displayStatus = deriveDisplayStatus(session.status, session.pauseReason);
	const config = DISPLAY_STATUS_CONFIG[displayStatus];
	const Icon = config.animated ? BlocksLoadingIcon : BlocksIcon;

	return (
		<span
			className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
			aria-label={`Status: ${config.label}`}
		>
			<Icon className={cn("h-3.5 w-3.5", config.colorClassName)} />
			{config.label}
		</span>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<h3 className="text-xs font-medium text-muted-foreground mb-1.5">{title}</h3>
			{children}
		</div>
	);
}

function PeekDrawerContent({
	session,
	pendingRunId,
}: { session: Session; pendingRunId?: string | null }) {
	const router = useRouter();
	const displayStatus = deriveDisplayStatus(session.status, session.pauseReason);
	const isResumable =
		session.snapshotId != null && (displayStatus === "idle" || displayStatus === "paused");

	const displayTitle =
		session.title ||
		session.promptSnippet ||
		(session.repo?.githubRepoName
			? `${session.repo.githubRepoName.split("/").pop()}${session.branchName ? ` (${session.branchName})` : ""}`
			: "Untitled session");

	const workspaceHref = pendingRunId
		? `/workspace/${session.id}?runId=${pendingRunId}`
		: `/workspace/${session.id}`;

	return (
		<div className="flex flex-col h-full">
			{/* Scrollable content */}
			<div className="flex-1 overflow-y-auto">
				<SheetHeader className="border-b border-border/50">
					<div className="flex items-center gap-2">
						<SheetTitle className="text-base truncate flex-1">
							{session.titleStatus === "generating" ? (
								<span className="inline-block h-5 w-48 rounded bg-muted-foreground/20 animate-pulse" />
							) : (
								displayTitle
							)}
						</SheetTitle>
						<StatusBadge session={session} />
					</div>
					{session.outcome && session.outcome !== "completed" && (
						<span
							className={cn("text-xs font-medium", getOutcomeDisplay(session.outcome).className)}
						>
							{getOutcomeDisplay(session.outcome).label}
						</span>
					)}
					{displayStatus === "blocked" && (
						<SheetDescription>
							{getBlockedReasonText(session.pauseReason, session.status)}
						</SheetDescription>
					)}
				</SheetHeader>

				<div className="p-4 space-y-4">
					{/* Initial prompt */}
					{session.initialPrompt && (
						<Section title="Prompt">
							<div className="rounded-md bg-muted/50 p-3 text-sm text-foreground whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
								{session.initialPrompt}
							</div>
						</Section>
					)}

					{/* Summary (sanitized markdown) */}
					{session.summary && (
						<Section title="Summary">
							<SanitizedMarkdown content={session.summary} />
						</Section>
					)}

					{/* PR Links */}
					{session.prUrls && session.prUrls.length > 0 && (
						<Section title={`Pull Request${session.prUrls.length > 1 ? "s" : ""}`}>
							<div className="space-y-1.5">
								{session.prUrls.filter(isHttpsUrl).map((url) => {
									const parsed = parsePrUrl(url);
									return (
										<a
											key={url}
											href={url}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-center gap-2 text-sm text-foreground hover:text-primary transition-colors group"
										>
											<GitPullRequest className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
											<span className="truncate">
												{parsed
													? `${parsed.repo}#${parsed.number}`
													: url.replace(/^https?:\/\//, "")}
											</span>
											<ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
										</a>
									);
								})}
							</div>
						</Section>
					)}

					{/* Metrics */}
					{session.metrics && (
						<Section title="Metrics">
							<div className="grid grid-cols-3 gap-3">
								<div>
									<div className="text-sm font-medium text-foreground">
										{session.metrics.toolCalls}
									</div>
									<div className="text-xs text-muted-foreground">Tools</div>
								</div>
								<div>
									<div className="text-sm font-medium text-foreground">
										{session.metrics.messagesExchanged}
									</div>
									<div className="text-xs text-muted-foreground">Messages</div>
								</div>
								<div>
									<div className="text-sm font-medium text-foreground">
										{formatActiveTime(session.metrics.activeSeconds)}
									</div>
									<div className="text-xs text-muted-foreground">Active</div>
								</div>
							</div>
						</Section>
					)}

					{/* Timeline */}
					<Section title="Timeline">
						<div className="space-y-1 text-sm">
							{session.startedAt && (
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Started</span>
									<span className="text-foreground">
										{formatDistanceToNow(new Date(session.startedAt), {
											addSuffix: true,
										})}
									</span>
								</div>
							)}
							{session.endedAt && (
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Ended</span>
									<span className="text-foreground">
										{formatDistanceToNow(new Date(session.endedAt), {
											addSuffix: true,
										})}
									</span>
								</div>
							)}
							{!session.endedAt && session.lastActivityAt && (
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Last activity</span>
									<span className="text-foreground">
										{formatDistanceToNow(new Date(session.lastActivityAt), {
											addSuffix: true,
										})}
									</span>
								</div>
							)}
							{session.metrics && session.metrics.activeSeconds > 0 && (
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Active time</span>
									<span className="text-foreground">
										{formatActiveTime(session.metrics.activeSeconds)}
									</span>
								</div>
							)}
						</div>
					</Section>

					{/* Context: repo, branch, automation */}
					{(session.repo || session.automation) && (
						<Section title="Context">
							<div className="space-y-1.5 text-sm">
								{session.repo && (
									<div className="flex items-center gap-2">
										<GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
										<a
											href={session.repo.githubUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="text-foreground hover:text-primary transition-colors truncate"
										>
											{session.repo.githubRepoName}
										</a>
										{session.branchName && (
											<span className="text-muted-foreground truncate">({session.branchName})</span>
										)}
									</div>
								)}
								{session.automation && (
									<button
										type="button"
										className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
										onClick={() =>
											router.push(`/dashboard/automations/${session.automation!.id}/events`)
										}
									>
										<Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
										<span className="truncate">{session.automation.name}</span>
									</button>
								)}
							</div>
						</Section>
					)}
				</div>
			</div>

			{/* CTA Footer */}
			<div className="border-t border-border/50 p-4">
				<Button className="w-full" size="sm" onClick={() => router.push(workspaceHref)}>
					{pendingRunId ? (
						<>
							<AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
							Investigate
						</>
					) : isResumable ? (
						<>
							<RotateCcw className="h-3.5 w-3.5 mr-1.5" />
							Resume Session
						</>
					) : (
						<>
							<ArrowRight className="h-3.5 w-3.5 mr-1.5" />
							Enter Workspace
						</>
					)}
				</Button>
			</div>
		</div>
	);
}

export function SessionPeekDrawer({ sessionId, pendingRunId, onClose }: SessionPeekDrawerProps) {
	const { data: session, isLoading, isError } = useSessionData(sessionId ?? "");

	return (
		<Sheet open={!!sessionId} onOpenChange={(open) => !open && onClose()}>
			<SheetContent side="right" className="w-[400px] max-w-[90vw] p-0">
				{isError ? (
					<div className="flex flex-col items-center justify-center h-full gap-3 p-4">
						<p className="text-sm text-muted-foreground">Session not found</p>
						<Button variant="outline" size="sm" onClick={onClose}>
							<X className="h-3.5 w-3.5 mr-1.5" />
							Close
						</Button>
					</div>
				) : isLoading || !session ? (
					<div className="flex items-center justify-center h-full">
						<BlocksLoadingIcon className="h-6 w-6 text-muted-foreground" />
					</div>
				) : (
					<PeekDrawerContent session={session} pendingRunId={pendingRunId} />
				)}
			</SheetContent>
		</Sheet>
	);
}
