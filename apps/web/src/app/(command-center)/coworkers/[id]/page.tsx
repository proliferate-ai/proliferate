"use client";

import { WorkerChatTab } from "@/components/automations/worker-chat-tab";
import { WorkerDetailHeader } from "@/components/automations/worker-detail-header";
import { WorkerFailureBanner } from "@/components/automations/worker-failure-banner";
import { WorkerSessionsTab } from "@/components/automations/worker-sessions-tab";
import { WorkerSettingsTab } from "@/components/automations/worker-settings-tab";
import { Button } from "@/components/ui/button";
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
	const [activeTab, setActiveTab] = useState<DetailTab>("chat");
	const { worker, isLoading, sessions, isLoadingSessions } = useWorkerDetail(id);
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

	const workerStatus = worker.status as
		| "active"
		| "automations_paused"
		| "degraded"
		| "failed"
		| "archived";
	const isManagerFailed = workerStatus === "degraded" || workerStatus === "failed";

	return (
		<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
			<div className="w-full max-w-4xl mx-auto px-6 py-6">
				<PageBackLink href="/coworkers" label="Coworkers" className="mb-3" />

				<WorkerDetailHeader
					worker={worker}
					onPause={actions.handlePause}
					onResume={actions.handleResume}
					onUpdateName={(name) => actions.handleUpdate({ name })}
					onUpdateDescription={(description) => actions.handleUpdate({ description })}
					isPausing={actions.isPausing}
					isResuming={actions.isResuming}
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
						<Button
							key={tab.value}
							variant="ghost"
							onClick={() => setActiveTab(tab.value)}
							className={cn(
								"px-3 py-1.5 h-auto text-sm font-medium rounded-md transition-colors",
								activeTab === tab.value
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
							)}
						>
							{tab.label}
						</Button>
					))}
				</div>

				{activeTab === "sessions" && (
					<WorkerSessionsTab sessions={sessions} isLoading={isLoadingSessions} />
				)}

				{activeTab === "chat" && worker.managerSessionId && (
					<WorkerChatTab managerSessionId={worker.managerSessionId} workerStatus={worker.status} />
				)}

				{activeTab === "configure" && (
					<WorkerSettingsTab
						worker={{
							id: worker.id,
							name: worker.name,
							systemPrompt: worker.systemPrompt,
							status: worker.status,
							modelId: worker.modelId,
							capabilities: worker.capabilities ?? [],
							managerSessionId: worker.managerSessionId ?? null,
							slackChannelId: worker.slackChannelId ?? null,
							slackInstallationId: worker.slackInstallationId ?? null,
						}}
						onUpdate={actions.handleUpdate}
						onPause={actions.handlePause}
						onResume={actions.handleResume}
						onDelete={actions.handleDelete}
						isUpdating={actions.isUpdating}
					/>
				)}

				{activeTab !== "chat" && <div className="h-12" />}
			</div>
		</div>
	);
}
