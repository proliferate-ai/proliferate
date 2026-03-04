"use client";

import { WorkerActivityTab } from "@/components/automations/worker-activity-tab";
import { WorkerDetailHeader } from "@/components/automations/worker-detail-header";
import { WorkerFailureBanner } from "@/components/automations/worker-failure-banner";
import { WorkerSessionsTab } from "@/components/automations/worker-sessions-tab";
import { WorkerSettingsTab } from "@/components/automations/worker-settings-tab";
import { PageBackLink } from "@/components/ui/page-back-link";
import { DETAIL_TABS, type DetailTab } from "@/config/coworkers";
import { useWorkerActions } from "@/hooks/automations/use-worker-actions";
import { useWorkerDetail } from "@/hooks/automations/use-worker-detail";
import { cn } from "@/lib/display/utils";
import { use, useState } from "react";

export default function CoworkerDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const [activeTab, setActiveTab] = useState<DetailTab>("activity");
	const {
		worker,
		isLoading,
		runs,
		sessions,
		directives,
		activeTaskCount,
		isLoadingRuns,
		isLoadingSessions,
	} = useWorkerDetail(id);
	const actions = useWorkerActions(id);

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

	if (!worker) {
		return (
			<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto">
				<div className="w-full max-w-4xl mx-auto px-6 py-8">
					<PageBackLink href="/coworkers" label="Coworkers" className="mb-3" />
					<p className="text-sm text-destructive">Coworker not found</p>
				</div>
			</div>
		);
	}

	const workerStatus = worker.status as "active" | "paused" | "degraded" | "failed";
	const isManagerFailed = workerStatus === "degraded" || workerStatus === "failed";

	return (
		<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
			<div className="w-full max-w-4xl mx-auto px-6 py-6">
				<PageBackLink href="/coworkers" label="Coworkers" className="mb-3" />

				<WorkerDetailHeader
					worker={worker}
					onPause={actions.handlePause}
					onResume={actions.handleResume}
					onRunNow={actions.handleRunNow}
					isPausing={actions.isPausing}
					isResuming={actions.isResuming}
					isRunningNow={actions.isRunningNow}
				/>

				{isManagerFailed && (
					<div className="mb-4">
						<WorkerFailureBanner
							status={workerStatus as "degraded" | "failed"}
							lastErrorCode={worker.lastErrorCode}
							onRestart={actions.handleRestart}
							onRecreate={actions.handleRestart}
							isRestarting={actions.isResuming}
						/>
					</div>
				)}

				{/* Tabs */}
				<div className="flex items-center gap-1 mb-6 border-b border-border/50 pb-3">
					{DETAIL_TABS.map((tab) => (
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

				{activeTab === "activity" && (
					<WorkerActivityTab
						workerId={id}
						worker={{
							status: worker.status,
							managerSessionId: worker.managerSessionId,
							lastWakeAt: worker.lastWakeAt?.toISOString() ?? null,
							lastErrorCode: worker.lastErrorCode,
						}}
						runs={runs}
						pendingDirectives={directives}
						activeTaskCount={activeTaskCount}
						pendingApprovalCount={0}
						isLoadingRuns={isLoadingRuns}
						onSendDirective={actions.handleSendDirective}
						isSendingDirective={actions.isSendingDirective}
					/>
				)}

				{activeTab === "sessions" && (
					<WorkerSessionsTab sessions={sessions} isLoading={isLoadingSessions} />
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
						onUpdate={actions.handleUpdate}
						onPause={actions.handlePause}
						onResume={actions.handleResume}
						onDelete={actions.handleDelete}
						isUpdating={actions.isUpdating}
					/>
				)}

				<div className="h-12" />
			</div>
		</div>
	);
}
