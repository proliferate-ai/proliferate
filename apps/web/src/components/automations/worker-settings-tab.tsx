"use client";

import { ModelSelector } from "@/components/automations/model-selector";
import {
	WorkerActionSelector,
	type WorkerCapabilityDraft,
} from "@/components/automations/worker-action-selector";
import { WorkerJobForm } from "@/components/automations/worker-job-form";
import { describeCron } from "@/components/automations/worker-job-utils";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSessionAvailableActions } from "@/hooks/actions/use-actions";
import {
	useCreateWorkerJob,
	useDeleteWorkerJob,
	useToggleWorkerJob,
	useUpdateWorkerJob,
	useWorkerJobs,
} from "@/hooks/automations/use-worker-jobs";
import {
	useCreateWorkerSlackChannel,
	useRemoveWorkerSlackChannel,
} from "@/hooks/automations/use-worker-slack";
import { useSlackInstallations } from "@/hooks/integrations/use-integrations";
import { useWsToken } from "@/hooks/sessions/use-ws-token";
import { cn } from "@/lib/display/utils";
import type { ModelId } from "@proliferate/shared";
import { formatDistanceToNow } from "date-fns";
import { Hash, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

interface WorkerSettingsTabProps {
	worker: {
		id: string;
		name: string;
		systemPrompt: string | null;
		status: string;
		modelId: string | null;
		capabilities?: WorkerCapabilityDraft[];
		managerSessionId: string | null;
		slackChannelId?: string | null;
		slackInstallationId?: string | null;
	};
	onUpdate: (fields: {
		name?: string;
		systemPrompt?: string;
		modelId?: string;
		capabilities?: WorkerCapabilityDraft[];
	}) => void;
	onPause: () => void;
	onResume: () => void;
	onDelete: () => void;
	isUpdating: boolean;
}

export function WorkerSettingsTab({
	worker,
	onUpdate,
	onPause,
	onResume,
	onDelete,
	isUpdating,
}: WorkerSettingsTabProps) {
	const [objectiveValue, setObjectiveValue] = useState(worker.systemPrompt || "");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
	const [hasPendingChanges, setHasPendingChanges] = useState(false);
	const [showJobForm, setShowJobForm] = useState(false);
	const [editingJobId, setEditingJobId] = useState<string | null>(null);
	const { token } = useWsToken();
	const { data: availableIntegrations, isLoading: isLoadingActions } = useSessionAvailableActions(
		worker.managerSessionId ?? "",
		token,
	);
	const { data: jobs, isLoading: isLoadingJobs } = useWorkerJobs(worker.id);
	const createJob = useCreateWorkerJob(worker.id);
	const updateJob = useUpdateWorkerJob(worker.id);
	const deleteJob = useDeleteWorkerJob(worker.id);
	const toggleJob = useToggleWorkerJob(worker.id);
	const createSlackChannel = useCreateWorkerSlackChannel(worker.id);
	const removeSlackChannel = useRemoveWorkerSlackChannel(worker.id);
	const { data: slackInstallations } = useSlackInstallations();
	const hasSlackInstallation = slackInstallations && slackInstallations.length > 0;
	const [capabilitiesValue, setCapabilitiesValue] = useState<WorkerCapabilityDraft[]>(
		worker.capabilities ?? [],
	);

	useEffect(() => {
		setCapabilitiesValue(worker.capabilities ?? []);
	}, [worker.capabilities]);

	const debouncedSaveObjective = useDebouncedCallback((value: string) => {
		onUpdate({ systemPrompt: value || undefined });
		setHasPendingChanges(false);
	}, 1000);

	const handleObjectiveChange = (value: string) => {
		setObjectiveValue(value);
		setHasPendingChanges(true);
		debouncedSaveObjective(value);
	};

	return (
		<div className="flex flex-col gap-6">
			{/* Name */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Name
				</p>
				<InlineEdit
					value={worker.name}
					onSave={(name) => onUpdate({ name })}
					className="min-w-0"
					displayClassName="text-sm font-medium text-foreground hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
					inputClassName="text-sm font-medium h-auto py-1 px-2 -mx-2 max-w-md"
				/>
			</div>

			{/* Objective */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Objective
				</p>
				<div className="relative rounded-lg border border-border overflow-hidden focus-within:border-foreground focus-within:ring-[0.5px] focus-within:ring-foreground transition-all">
					<Textarea
						value={objectiveValue}
						onChange={(e) => handleObjectiveChange(e.target.value)}
						placeholder="Describe what this coworker should do..."
						className={cn(
							"w-full text-sm focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 border-none resize-none px-4 py-3 bg-transparent rounded-none min-h-0",
							"placeholder:text-muted-foreground/60",
						)}
						style={{ minHeight: "120px" }}
					/>
					<div className="flex items-center bg-muted/50 border-t border-border/50 px-4 py-2">
						<p className="text-xs text-muted-foreground">
							{hasPendingChanges || isUpdating ? "Saving..." : "Auto-saves as you type"}
						</p>
					</div>
				</div>
			</div>

			{/* Model */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Model
				</p>
				<div className="rounded-lg border border-border">
					<div className="flex items-center justify-between px-4 py-2.5">
						<span className="text-sm text-muted-foreground">Default model</span>
						<ModelSelector
							modelId={(worker.modelId || "anthropic/claude-sonnet-4-20250514") as ModelId}
							onChange={(modelId) => onUpdate({ modelId })}
							variant="outline"
							triggerClassName="h-8 border-0 bg-muted/30 hover:bg-muted"
						/>
					</div>
				</div>
			</div>

			{/* Actions */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Actions
				</p>
				<WorkerActionSelector
					value={capabilitiesValue}
					availableIntegrations={availableIntegrations ?? []}
					isLoadingActions={isLoadingActions}
					disabled={isUpdating}
					onChange={(next) => {
						setCapabilitiesValue(next);
						onUpdate({ capabilities: next });
					}}
				/>
			</div>

			{/* Slack Channel */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Slack Channel
				</p>
				{worker.slackChannelId ? (
					<div className="rounded-lg border border-border">
						<div className="flex items-center justify-between px-4 py-2.5">
							<div className="flex items-center gap-2">
								<Hash className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm text-foreground">Channel connected</span>
							</div>
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-xs"
								onClick={() => removeSlackChannel.mutate({ workerId: worker.id })}
								disabled={removeSlackChannel.isPending}
							>
								Disconnect
							</Button>
						</div>
					</div>
				) : hasSlackInstallation ? (
					<div className="rounded-lg border border-border px-4 py-4">
						<p className="text-sm text-muted-foreground mb-3">
							Create a dedicated Slack channel for this coworker. Messages in the channel will be
							routed here.
						</p>
						<Button
							size="sm"
							onClick={() => createSlackChannel.mutate({ workerId: worker.id })}
							disabled={createSlackChannel.isPending}
						>
							{createSlackChannel.isPending ? "Creating..." : "Create Slack Channel"}
						</Button>
					</div>
				) : (
					<div className="rounded-lg border border-border px-4 py-4">
						<p className="text-sm text-muted-foreground">
							Connect Slack in Settings to enable a dedicated channel for this coworker.
						</p>
					</div>
				)}
			</div>

			{/* Scheduled Jobs */}
			<div>
				<div className="flex items-center justify-between mb-2">
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
						Scheduled Jobs
					</p>
					{!showJobForm && (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-2 text-xs"
							onClick={() => {
								setShowJobForm(true);
								setEditingJobId(null);
							}}
						>
							<Plus className="h-3 w-3 mr-1" />
							Add Job
						</Button>
					)}
				</div>

				{showJobForm && !editingJobId && (
					<div className="mb-3">
						<WorkerJobForm
							onSubmit={(values) => {
								createJob.mutate(
									{ workerId: worker.id, ...values },
									{ onSuccess: () => setShowJobForm(false) },
								);
							}}
							onCancel={() => setShowJobForm(false)}
							isSubmitting={createJob.isPending}
						/>
					</div>
				)}

				{isLoadingJobs ? (
					<div className="rounded-lg border border-border px-4 py-3">
						<div className="h-4 w-32 bg-muted rounded animate-pulse" />
					</div>
				) : !jobs || jobs.length === 0 ? (
					!showJobForm && (
						<div className="rounded-lg border border-border px-4 py-4">
							<p className="text-sm text-muted-foreground">
								No scheduled jobs. Add a job to have this coworker check in on a schedule.
							</p>
						</div>
					)
				) : (
					<div className="rounded-lg border border-border divide-y divide-border">
						{jobs.map((job) =>
							editingJobId === job.id ? (
								<div key={job.id} className="p-3">
									<WorkerJobForm
										initialValues={{
											name: job.name,
											checkInPrompt: job.checkInPrompt,
											cronExpression: job.cronExpression,
											description: job.description ?? undefined,
											enabled: job.enabled,
										}}
										onSubmit={(values) => {
											updateJob.mutate(
												{ jobId: job.id, ...values },
												{ onSuccess: () => setEditingJobId(null) },
											);
										}}
										onCancel={() => setEditingJobId(null)}
										isSubmitting={updateJob.isPending}
									/>
								</div>
							) : (
								<div key={job.id} className="flex items-center gap-3 px-4 py-2.5">
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium text-foreground truncate">
												{job.name}
											</span>
											<span className="text-xs text-muted-foreground shrink-0">
												{describeCron(job.cronExpression)}
											</span>
										</div>
										{job.lastTickAt && (
											<p className="text-xs text-muted-foreground mt-0.5">
												Last run{" "}
												{formatDistanceToNow(new Date(job.lastTickAt), {
													addSuffix: true,
												})}
											</p>
										)}
									</div>
									<div className="flex items-center gap-2 shrink-0">
										<Switch
											checked={job.enabled}
											onCheckedChange={(checked) => {
												toggleJob.mutate({
													jobId: job.id,
													enabled: checked,
												});
											}}
										/>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 w-7 p-0"
											onClick={() => {
												setEditingJobId(job.id);
												setShowJobForm(false);
											}}
										>
											<Pencil className="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 w-7 p-0 text-destructive hover:text-destructive"
											onClick={() => setDeleteJobId(job.id)}
										>
											<Trash2 className="h-3.5 w-3.5" />
										</Button>
									</div>
								</div>
							),
						)}
					</div>
				)}
			</div>

			{/* Status toggle */}
			<div>
				<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
					Status
				</p>
				<div className="rounded-lg border border-border">
					<div className="flex items-center justify-between px-4 py-2.5">
						<span className="text-sm text-muted-foreground">
							{worker.status === "automations_paused" ? "Coworker is paused" : "Coworker is active"}
						</span>
						<div className="flex items-center gap-2">
							<Switch
								checked={worker.status === "active"}
								onCheckedChange={(checked) => {
									if (checked) onResume();
									else onPause();
								}}
								disabled={worker.status === "degraded" || worker.status === "failed"}
							/>
							<span className="text-sm capitalize">{worker.status}</span>
						</div>
					</div>
				</div>
			</div>

			{/* Danger zone */}
			<div className="rounded-lg border border-destructive/20 bg-destructive/5 p-5">
				<h3 className="text-sm font-medium text-foreground mb-1">Danger zone</h3>
				<p className="text-xs text-muted-foreground mb-3">
					Permanently delete this coworker and all associated data. This action cannot be undone.
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={() => setDeleteDialogOpen(true)}
					className="border-destructive/30 text-destructive hover:bg-destructive/10"
				>
					<Trash2 className="h-3.5 w-3.5 mr-1.5" />
					Delete coworker
				</Button>
			</div>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Coworker</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete &quot;{worker.name}&quot; and its manager session. This
							action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={onDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={!!deleteJobId} onOpenChange={(open) => !open && setDeleteJobId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Job</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this scheduled job. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deleteJobId) {
									deleteJob.mutate(
										{ jobId: deleteJobId },
										{ onSuccess: () => setDeleteJobId(null) },
									);
								}
							}}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
