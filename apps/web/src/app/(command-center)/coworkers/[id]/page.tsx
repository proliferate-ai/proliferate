"use client";

import { LegacyAutomationDetail } from "@/components/automations/legacy-automation-detail";
import { WorkerActivityTab } from "@/components/automations/worker-activity-tab";
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
import { COWORKER_DETAIL_TABS, type CoworkerDetailTab } from "@/config/coworkers";
import {
	useCoworkerActions,
	useCoworkerDetailData,
} from "@/hooks/automations/use-coworker-actions";
import { useAutomation } from "@/hooks/use-automations";
import { useWorker } from "@/hooks/use-workers";
import { cn } from "@/lib/utils";
import { ExternalLink, Loader2, MoreVertical, Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";

export default function CoworkerDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const [activeTab, setActiveTab] = useState<CoworkerDetailTab>("activity");

	const { data: worker, isLoading: isLoadingWorker, error: workerError } = useWorker(id);
	const { isLoading: isLoadingAutomation } = useAutomation(id);

	const isWorkerActive = worker?.status === "active";
	const hasWorker = !!worker && !workerError;
	const isLoading = isLoadingWorker && isLoadingAutomation;

	const {
		handleSendDirective,
		handlePause,
		handleResume,
		handleRunNow,
		handleDelete,
		handleRestart,
		updateWorker,
		sendDirective,
		pauseWorker,
		resumeWorker,
		runNow,
	} = useCoworkerActions(id);

	const {
		workerSessions,
		activeTaskCount,
		mappedRuns,
		mappedDirectives,
		isLoadingRuns,
		isLoadingSessions,
	} = useCoworkerDetailData(id, isWorkerActive);

	const pendingApprovalCount = 0;

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

	if (hasWorker) {
		const workerStatus = worker.status as "active" | "paused" | "degraded" | "failed";
		const isManagerFailed = workerStatus === "degraded" || workerStatus === "failed";

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

					{/* Manager failure banner */}
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
						{COWORKER_DETAIL_TABS.map((tab) => (
							<Button
								key={tab.value}
								variant="ghost"
								size="sm"
								onClick={() => setActiveTab(tab.value)}
								className={cn(
									"px-3 py-1.5 text-sm font-medium rounded-md",
									activeTab === tab.value ? "bg-muted text-foreground" : "text-muted-foreground",
								)}
							>
								{tab.label}
							</Button>
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

	return <LegacyAutomationDetail id={id} />;
}
