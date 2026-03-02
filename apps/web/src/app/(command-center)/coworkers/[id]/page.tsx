"use client";

import {
	type ChildSession,
	type PendingDirective,
	WorkerActivityTab,
	type WorkerRunWithEvents,
} from "@/components/automations/worker-activity-tab";
import { WorkerFailureBanner } from "@/components/automations/worker-failure-banner";
import { WorkerSessionsTab } from "@/components/automations/worker-sessions-tab";
import { WorkerSettingsTab } from "@/components/automations/worker-settings-tab";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageBackLink } from "@/components/ui/page-back-link";
import { StatusDot } from "@/components/ui/status-dot";
import { useAutomation } from "@/hooks/use-automations";
import {
	useDeleteWorker,
	usePauseWorker,
	usePendingDirectives,
	useResumeWorker,
	useRunWorkerNow,
	useSendDirective,
	useUpdateWorker,
	useWorker,
	useWorkerRuns,
	useWorkerSessions,
} from "@/hooks/use-workers";
import { cn } from "@/lib/utils";
import { ExternalLink, Loader2, MoreVertical, Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

// ============================================
// Types
// ============================================

type DetailTab = "activity" | "sessions" | "settings";

const TABS: { value: DetailTab; label: string }[] = [
	{ value: "activity", label: "Activity" },
	{ value: "sessions", label: "Sessions" },
	{ value: "settings", label: "Settings" },
];

// ============================================
// Page Component
// ============================================

export default function CoworkerDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const router = useRouter();
	const [activeTab, setActiveTab] = useState<DetailTab>("activity");

	// Data — try V1 worker first, fall back to legacy automation
	const { data: worker, isLoading: isLoadingWorker, error: workerError } = useWorker(id);
	const { data: automation, isLoading: isLoadingAutomation } = useAutomation(id);

	// Determine if the worker is in a state that benefits from polling
	const isWorkerActive = worker?.status === "active";

	// Worker-specific data (poll when active)
	const { data: runs = [], isLoading: isLoadingRuns } = useWorkerRuns(id, {
		limit: 10,
		pollingEnabled: isWorkerActive,
	});
	const { data: workerSessions = [], isLoading: isLoadingSessions } = useWorkerSessions(id, {
		pollingEnabled: isWorkerActive,
	});
	const { data: pendingDirectives = [] } = usePendingDirectives(id);

	// Mutations
	const pauseWorker = usePauseWorker();
	const resumeWorker = useResumeWorker();
	const runNow = useRunWorkerNow();
	const sendDirective = useSendDirective(id);
	const updateWorker = useUpdateWorker(id);
	const deleteWorker = useDeleteWorker();

	const isLoading = isLoadingWorker && isLoadingAutomation;

	// Determine if we have a V1 worker
	const hasWorker = !!worker && !workerError;

	// Compute aggregate counts from runs/sessions
	const activeTaskCount = useMemo(
		() =>
			workerSessions.filter(
				(s) => s.status !== "completed" && s.status !== "failed" && s.status !== "cancelled",
			).length,
		[workerSessions],
	);

	const pendingApprovalCount = 0; // Will be enriched by the backend

	const handleSendDirective = useCallback(
		async (content: string) => {
			try {
				await sendDirective.mutateAsync({ workerId: id, content });
				toast.success("Directive sent");
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Failed to send directive");
			}
		},
		[id, sendDirective],
	);

	const handlePause = useCallback(() => {
		pauseWorker.mutate(
			{ workerId: id },
			{
				onSuccess: () => toast.success("Coworker paused"),
				onError: (err) => toast.error(err.message || "Failed to pause"),
			},
		);
	}, [id, pauseWorker]);

	const handleResume = useCallback(() => {
		resumeWorker.mutate(
			{ workerId: id },
			{
				onSuccess: () => toast.success("Coworker resumed"),
				onError: (err) => toast.error(err.message || "Failed to resume"),
			},
		);
	}, [id, resumeWorker]);

	const handleRunNow = useCallback(() => {
		runNow.mutate(
			{ workerId: id },
			{
				onSuccess: () => toast.success("Wake event queued"),
				onError: (err) => toast.error(err.message || "Failed to run"),
			},
		);
	}, [id, runNow]);

	const handleDelete = useCallback(() => {
		deleteWorker.mutate(
			{ id },
			{
				onSuccess: () => {
					toast.success("Coworker deleted");
					router.push("/coworkers");
				},
				onError: (err) => toast.error(err.message || "Failed to delete"),
			},
		);
	}, [id, deleteWorker, router]);

	const handleRestart = useCallback(() => {
		// For now, resume is the restart action for degraded/failed
		resumeWorker.mutate(
			{ workerId: id },
			{
				onSuccess: () => toast.success("Manager restarted"),
				onError: (err) => toast.error(err.message || "Failed to restart"),
			},
		);
	}, [id, resumeWorker]);

	// Loading state
	if (isLoading) {
		return (
			<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto">
				<div className="w-full max-w-4xl mx-auto px-6 py-8">
					<div className="animate-pulse space-y-6">
						<div className="h-8 w-48 bg-muted rounded" />
						<div className="h-12 bg-muted rounded-xl" />
						<div className="h-48 bg-muted rounded-xl" />
					</div>
				</div>
			</div>
		);
	}

	// If we have a V1 worker, show the new detail page
	if (hasWorker) {
		const workerStatus = worker.status as "active" | "paused" | "degraded" | "failed";
		const isManagerFailed = workerStatus === "degraded" || workerStatus === "failed";

		// Map runs to the component's expected shape (convert Date → string)
		const mappedRuns: WorkerRunWithEvents[] = runs.map((run) => ({
			id: run.id,
			workerId: run.workerId,
			status: run.status,
			summary: run.summary,
			wakeEventId: run.wakeEventId,
			createdAt: run.createdAt.toISOString(),
			startedAt: run.startedAt?.toISOString() ?? null,
			completedAt: run.completedAt?.toISOString() ?? null,
			events: run.events.map((e) => ({
				id: e.id,
				eventIndex: e.eventIndex,
				eventType: e.eventType,
				summaryText: e.summaryText,
				payloadJson: e.payloadJson,
				sessionId: e.sessionId,
				actionInvocationId: e.actionInvocationId,
				createdAt: e.createdAt.toISOString(),
			})),
			childSessions: [] as ChildSession[],
		}));

		const mappedDirectives: PendingDirective[] = pendingDirectives.map((d) => ({
			id: d.id,
			messageType: d.messageType,
			payloadJson: d.payloadJson,
			queuedAt: d.queuedAt.toISOString(),
			senderUserId: d.senderUserId,
		}));

		return (
			<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
				<div className="w-full max-w-4xl mx-auto px-6 py-6">
					<PageBackLink href="/coworkers" label="Coworkers" className="mb-3" />

					{/* Header */}
					<div className="flex items-center gap-3 mb-4">
						<h1 className="text-lg font-semibold tracking-tight text-foreground truncate">
							{worker.name}
						</h1>

						<div className="flex items-center gap-2 ml-2">
							<StatusDot
								status={
									workerStatus === "active"
										? "active"
										: workerStatus === "paused"
											? "paused"
											: "error"
								}
								size="sm"
							/>
							<span className="text-sm capitalize text-muted-foreground">{workerStatus}</span>
						</div>

						{worker.objective && (
							<span className="text-xs text-muted-foreground truncate hidden md:block ml-2">
								{worker.objective}
							</span>
						)}

						<div className="flex items-center gap-1.5 ml-auto">
							{/* Quick actions based on status */}
							{workerStatus === "active" && (
								<>
									<Button
										size="sm"
										variant="outline"
										className="h-7 gap-1.5 text-xs"
										onClick={handleRunNow}
										disabled={runNow.isPending}
									>
										{runNow.isPending ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : (
											<Play className="h-3 w-3" />
										)}
										Run now
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="h-7 gap-1.5 text-xs"
										onClick={handlePause}
										disabled={pauseWorker.isPending}
									>
										<Pause className="h-3 w-3" />
										Pause
									</Button>
								</>
							)}
							{workerStatus === "paused" && (
								<Button
									size="sm"
									variant="outline"
									className="h-7 gap-1.5 text-xs"
									onClick={handleResume}
									disabled={resumeWorker.isPending}
								>
									<Play className="h-3 w-3" />
									Resume
								</Button>
							)}

							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="icon" className="h-8 w-8">
										<MoreVertical className="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem asChild>
										<Link href={`/workspace/${worker.managerSessionId}`}>
											<ExternalLink className="h-4 w-4 mr-2" />
											Open manager session
										</Link>
									</DropdownMenuItem>
									{workerStatus === "active" && (
										<DropdownMenuItem onClick={handleRunNow} disabled={runNow.isPending}>
											<Play className="h-4 w-4 mr-2" />
											Run now
										</DropdownMenuItem>
									)}
									<DropdownMenuSeparator />
									<DropdownMenuItem onClick={handleDelete} className="text-destructive">
										<RotateCcw className="h-4 w-4 mr-2" />
										Delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>

					{/* Manager failure banner (H7) */}
					{isManagerFailed && (
						<div className="mb-4">
							<WorkerFailureBanner
								status={workerStatus as "degraded" | "failed"}
								lastErrorCode={worker.lastErrorCode}
								onRestart={handleRestart}
								onRecreate={handleRestart}
								isRestarting={resumeWorker.isPending}
							/>
						</div>
					)}

					{/* Tabs */}
					<div className="flex items-center gap-1 mb-6 border-b border-border/50 pb-3">
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
							</button>
						))}
					</div>

					{/* Tab content */}
					{activeTab === "activity" && (
						<WorkerActivityTab
							workerId={id}
							worker={{
								status: worker.status,
								managerSessionId: worker.managerSessionId,
								lastWakeAt: worker.lastWakeAt?.toISOString() ?? null,
								lastErrorCode: worker.lastErrorCode,
							}}
							runs={mappedRuns}
							pendingDirectives={mappedDirectives}
							activeTaskCount={activeTaskCount}
							pendingApprovalCount={pendingApprovalCount}
							isLoadingRuns={isLoadingRuns}
							onSendDirective={handleSendDirective}
							isSendingDirective={sendDirective.isPending}
						/>
					)}

					{activeTab === "sessions" && (
						<WorkerSessionsTab
							sessions={workerSessions.map((s) => ({
								id: s.id,
								title: s.title,
								status: s.status ?? "unknown",
								repoId: s.repoId,
								branchName: s.branchName,
								operatorStatus: s.operatorStatus,
								updatedAt: s.updatedAt?.toISOString() ?? new Date().toISOString(),
								startedAt: s.startedAt?.toISOString() ?? null,
							}))}
							isLoading={isLoadingSessions}
						/>
					)}

					{activeTab === "settings" && (
						<WorkerSettingsTab
							worker={{
								id: worker.id,
								name: worker.name,
								objective: worker.objective,
								status: worker.status,
								modelId: worker.modelId,
							}}
							onUpdate={(fields) => updateWorker.mutate(fields)}
							onPause={handlePause}
							onResume={handleResume}
							onDelete={handleDelete}
							isUpdating={updateWorker.isPending}
						/>
					)}

					<div className="h-12" />
				</div>
			</div>
		);
	}

	// Fallback: Render legacy automation detail page
	// (This preserves the existing automation detail for non-V1 workers)
	return <LegacyAutomationDetail id={id} />;
}

// ============================================
// Legacy automation detail (preserved from existing code)
// ============================================

function LegacyAutomationDetail({ id }: { id: string }) {
	const router = useRouter();

	// Redirect to the original detail page pattern
	// For the legacy automation flow, we keep the existing page as-is
	// by importing the components directly
	const { data: automation, isLoading, error } = useAutomation(id);

	if (isLoading) {
		return (
			<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto">
				<div className="w-full max-w-4xl mx-auto px-6 py-8">
					<div className="animate-pulse space-y-6">
						<div className="h-8 w-48 bg-muted rounded" />
						<div className="h-12 bg-muted rounded-xl" />
						<div className="h-48 bg-muted rounded-xl" />
					</div>
				</div>
			</div>
		);
	}

	if (error || !automation) {
		return (
			<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto">
				<div className="w-full max-w-4xl mx-auto px-6 py-8">
					<PageBackLink href="/coworkers" label="Coworkers" className="mb-3" />
					<p className="text-sm text-destructive">Coworker not found</p>
				</div>
			</div>
		);
	}

	// For legacy automations, redirect to keep old behavior working
	// The old detail page is fully functional for automations
	return (
		<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto">
			<div className="w-full max-w-4xl mx-auto px-6 py-8">
				<PageBackLink href="/coworkers" label="Coworkers" className="mb-3" />
				<div className="flex items-center gap-3 mb-6">
					<h1 className="text-lg font-semibold tracking-tight text-foreground">
						{automation.name}
					</h1>
					<StatusDot status={automation.enabled ? "active" : "paused"} size="sm" />
					<span className="text-sm text-muted-foreground">
						{automation.enabled ? "Active" : "Paused"}
					</span>
				</div>
				<p className="text-sm text-muted-foreground">
					This coworker uses the legacy automation system. Configuration is available via the events
					page.
				</p>
				<div className="flex gap-2 mt-4">
					<Button size="sm" variant="outline" asChild>
						<Link href={`/coworkers/${id}/events`}>View events</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}
