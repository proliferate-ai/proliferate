"use client";

import { WorkerSettingsTab } from "@/components/automations/worker-settings-tab";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useWorkerActions } from "@/hooks/automations/use-worker-actions";
import { useWorker } from "@/hooks/automations/use-workers";

interface CoworkerConfigurePanelProps {
	workerId: string;
}

export function CoworkerConfigurePanel({ workerId }: CoworkerConfigurePanelProps) {
	const { data: worker, isLoading } = useWorker(workerId);
	const actions = useWorkerActions(workerId);

	if (isLoading || !worker) {
		return (
			<div className="flex items-center justify-center py-12">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	return (
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
	);
}
