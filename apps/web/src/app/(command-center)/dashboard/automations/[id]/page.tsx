"use client";

import { AddTriggerButton } from "@/components/automations/add-trigger-button";
import { ConfigurationSelector } from "@/components/automations/configuration-selector";
import { IntegrationPermissions } from "@/components/automations/integration-permissions";
import { ModelSelector } from "@/components/automations/model-selector";
import { TriggerChip } from "@/components/automations/trigger-chip";
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
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InlineEdit } from "@/components/ui/inline-edit";
import { PageBackLink } from "@/components/ui/page-back-link";
import { StatusDot } from "@/components/ui/status-dot";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAutomationActionModes, useSetAutomationActionMode } from "@/hooks/use-action-modes";
import { useAutomation, useTriggerManualRun, useUpdateAutomation } from "@/hooks/use-automations";
import { useConfigurations } from "@/hooks/use-configurations";
import { useIntegrations, useSlackInstallations } from "@/hooks/use-integrations";
import { computeReadiness } from "@/lib/automation-readiness";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import {
	type AutomationWithTriggers,
	type ModelId,
	type UpdateAutomationInput,
	getDefaultAgentConfig,
	isValidModelId,
	parseModelId,
} from "@proliferate/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, History, Loader2, MoreVertical, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

// ============================================
// Types
// ============================================

interface ToolConfig {
	enabled: boolean;
	channelId?: string;
	teamId?: string;
	defaultTo?: string;
}

interface EnabledTools {
	slack_notify?: ToolConfig;
	create_linear_issue?: ToolConfig;
	email_user?: ToolConfig;
	create_session?: ToolConfig;
}

// ============================================
// Helpers
// ============================================

function formatRelativeTime(dateString: string): string {
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffSecs = Math.floor(diffMs / 1000);
	const diffMins = Math.floor(diffSecs / 60);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffSecs < 60) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;
	return date.toLocaleDateString();
}

/** Map camelCase update input to snake_case for optimistic cache updates */
function mapInputToOutput(data: UpdateAutomationInput): Record<string, unknown> {
	const mapped: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (key === "defaultConfigurationId") mapped.default_configuration_id = value;
		else if (key === "allowAgenticRepoSelection") mapped.allow_agentic_repo_selection = value;
		else if (key === "agentInstructions") mapped.agent_instructions = value;
		else if (key === "agentType") mapped.agent_type = value;
		else if (key === "modelId") mapped.model_id = value;
		else if (key === "llmFilterPrompt") mapped.llm_filter_prompt = value;
		else if (key === "enabledTools") mapped.enabled_tools = value;
		else if (key === "llmAnalysisPrompt") mapped.llm_analysis_prompt = value;
		else if (key === "notificationSlackInstallationId")
			mapped.notification_slack_installation_id = value;
		else mapped[key] = value;
	}
	return mapped;
}

// ============================================
// Page Component
// ============================================

export default function AutomationDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const router = useRouter();
	const queryClient = useQueryClient();

	// Local state
	const [instructionsValue, setInstructionsValue] = useState("");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [llmFilterPrompt, setLlmFilterPrompt] = useState("");
	const [llmAnalysisPrompt, setLlmAnalysisPrompt] = useState("");
	const [enabledTools, setEnabledTools] = useState<EnabledTools>({});
	const [hasPendingChanges, setHasPendingChanges] = useState(false);
	const [notificationSlackInstallationId, setNotificationSlackInstallationId] = useState<
		string | null
	>(null);
	const hydratedRef = useRef(false);

	// Data
	const { data: automation, isLoading, error } = useAutomation(id);
	const { data: integrationsData } = useIntegrations();
	const { data: slackInstallations } = useSlackInstallations();
	const { data: modesData } = useAutomationActionModes(id);
	const setActionMode = useSetAutomationActionMode(id);
	const actionModes = modesData?.modes ?? {};
	const { data: configurations } = useConfigurations();

	const connectedProviders = useMemo(() => {
		const providers = new Set<string>();
		if (!integrationsData) return providers;
		if (integrationsData.github.connected) providers.add("github");
		if (integrationsData.sentry.connected) providers.add("sentry");
		if (integrationsData.linear.connected) providers.add("linear");
		if (slackInstallations && slackInstallations.length > 0) providers.add("slack");
		return providers;
	}, [integrationsData, slackInstallations]);

	// Filter to only ready configurations
	const readyConfigurations = useMemo(() => {
		return (configurations ?? []).filter((c) => c.status === "ready" || c.status === "default");
	}, [configurations]);

	// Mutations
	const updateMutation = useUpdateAutomation(id);
	const triggerManualRun = useTriggerManualRun(id);

	// Initialize local state from automation data (only on first load)
	useEffect(() => {
		if (automation && !hydratedRef.current) {
			hydratedRef.current = true;
			setInstructionsValue(automation.agent_instructions || "");
			setLlmFilterPrompt(automation.llm_filter_prompt || "");
			setLlmAnalysisPrompt(automation.llm_analysis_prompt || "");
			setEnabledTools((automation.enabled_tools as EnabledTools) || {});
			setNotificationSlackInstallationId(automation.notification_slack_installation_id ?? null);
		}
	}, [automation]);

	// Optimistic update helper
	const handleUpdate = useCallback(
		(data: UpdateAutomationInput) => {
			const mappedData = mapInputToOutput(data);

			queryClient.setQueryData(
				orpc.automations.list.key(),
				(old: { automations: Array<{ id: string; [key: string]: unknown }> } | undefined) => {
					if (!old) return old;
					return {
						...old,
						automations: old.automations.map((a) =>
							a.id === id ? { ...a, ...mappedData, updated_at: new Date().toISOString() } : a,
						),
					};
				},
			);

			queryClient.setQueryData(
				orpc.automations.get.key({ input: { id } }),
				(old: { automation: AutomationWithTriggers } | undefined) => {
					if (!old) return old;
					return {
						...old,
						automation: {
							...old.automation,
							...mappedData,
							updated_at: new Date().toISOString(),
						},
					};
				},
			);

			updateMutation.mutate(data);
		},
		[id, queryClient, updateMutation],
	);

	// Delete mutation
	const deleteMutation = useMutation({
		...orpc.automations.delete.mutationOptions(),
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: orpc.automations.list.key() });
			const previousAutomations = queryClient.getQueryData(orpc.automations.list.key());

			queryClient.setQueryData(
				orpc.automations.list.key(),
				(old: { automations: Array<{ id: string; [key: string]: unknown }> } | undefined) => {
					if (!old) return old;
					return {
						...old,
						automations: old.automations.filter((a) => a.id !== id),
					};
				},
			);

			return { previousAutomations };
		},
		onError: (_err, _vars, context) => {
			if (context?.previousAutomations) {
				queryClient.setQueryData(orpc.automations.list.key(), context.previousAutomations);
			}
		},
		onSuccess: () => {
			router.push("/dashboard");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: orpc.automations.list.key() });
		},
	});

	// Debounced saves
	const debouncedSaveInstructions = useDebouncedCallback((value: string) => {
		handleUpdate({ agentInstructions: value || undefined });
		setHasPendingChanges(false);
	}, 1000);

	const debouncedSaveLlmFilterPrompt = useDebouncedCallback((value: string) => {
		handleUpdate({ llmFilterPrompt: value || null });
		setHasPendingChanges(false);
	}, 1000);

	const debouncedSaveLlmAnalysisPrompt = useDebouncedCallback((value: string) => {
		handleUpdate({ llmAnalysisPrompt: value || null });
		setHasPendingChanges(false);
	}, 1000);

	// Handlers
	const handleNameSave = useCallback(
		(name: string) => {
			handleUpdate({ name });
		},
		[handleUpdate],
	);

	const handleModelChange = useCallback(
		(modelId: ModelId) => {
			handleUpdate({ modelId });
		},
		[handleUpdate],
	);

	const handleConfigurationChange = useCallback(
		(configurationId: string) => {
			handleUpdate({
				defaultConfigurationId: configurationId === "none" ? null : configurationId,
			});
		},
		[handleUpdate],
	);

	const handleInstructionsChange = (value: string) => {
		setInstructionsValue(value);
		setHasPendingChanges(true);
		debouncedSaveInstructions(value);
	};

	const handleLlmFilterPromptChange = (value: string) => {
		setLlmFilterPrompt(value);
		setHasPendingChanges(true);
		debouncedSaveLlmFilterPrompt(value);
	};

	const handleLlmAnalysisPromptChange = (value: string) => {
		setLlmAnalysisPrompt(value);
		setHasPendingChanges(true);
		debouncedSaveLlmAnalysisPrompt(value);
	};

	const handleToolToggle = (toolName: keyof EnabledTools, enabled: boolean) => {
		const newTools = {
			...enabledTools,
			[toolName]: { ...enabledTools[toolName], enabled },
		};
		setEnabledTools(newTools);
		handleUpdate({ enabledTools: newTools });
		// Invalidate dynamic permissions so they refresh when tools change
		queryClient.invalidateQueries({
			queryKey: orpc.automations.getIntegrationActions.key({ input: { id } }),
		});
	};

	const debouncedSaveTools = useDebouncedCallback((tools: EnabledTools) => {
		handleUpdate({ enabledTools: tools as Record<string, unknown> });
	}, 500);

	const handleToolConfigChange = (
		toolName: keyof EnabledTools,
		configKey: string,
		value: string,
	) => {
		const newTools = {
			...enabledTools,
			[toolName]: { ...enabledTools[toolName], [configKey]: value || undefined },
		};
		setEnabledTools(newTools);
		debouncedSaveTools(newTools);
	};

	const handleSlackInstallationChange = (installationId: string | null) => {
		setNotificationSlackInstallationId(installationId);
		handleUpdate({ notificationSlackInstallationId: installationId });
	};

	const handleRunNow = () => {
		if (!readiness.ready) {
			toast.warning(`Cannot run: ${readiness.issues.map((i) => i.message).join(", ")}`);
			return;
		}
		triggerManualRun.mutate(
			{ id },
			{
				onSuccess: (data) => {
					const runId = data?.run?.id;
					toast.success("Run started", {
						action: runId
							? {
									label: "View",
									onClick: () => router.push(`/dashboard/automations/${id}/events?runId=${runId}`),
								}
							: undefined,
					});
				},
				onError: (err) => toast.error(err.message || "Failed to start run"),
			},
		);
	};

	// Loading state
	if (isLoading) {
		return (
			<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto">
				<div className="w-full max-w-4xl mx-auto px-6 py-8">
					<div className="animate-pulse space-y-6">
						<div className="h-8 w-48 bg-muted rounded" />
						<div className="h-12 bg-muted rounded-xl" />
						<div className="h-48 bg-muted rounded-xl" />
						<div className="h-32 bg-muted rounded-xl" />
					</div>
				</div>
			</div>
		);
	}

	if (error || !automation) {
		return (
			<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto">
				<div className="w-full max-w-4xl mx-auto px-6 py-8">
					<Text variant="body" color="destructive">
						Failed to load automation
					</Text>
				</div>
			</div>
		);
	}

	const allTriggers = automation.triggers ?? [];
	const isManualTrigger = (t: { config?: Record<string, unknown> | null }) =>
		(t.config as Record<string, unknown> | null)?._manual === true;
	const triggers = allTriggers.filter((t) => !isManualTrigger(t) && t.provider !== "scheduled");
	const schedules = allTriggers.filter((t) => t.provider === "scheduled");

	const readiness = computeReadiness({
		enabledTools,
		connectedProviders,
		agentInstructions: instructionsValue,
		triggerProviders: allTriggers.filter((t) => !isManualTrigger(t)).map((t) => t.provider),
	});

	const resolvedModelId =
		automation.model_id && isValidModelId(automation.model_id)
			? automation.model_id
			: automation.model_id
				? parseModelId(automation.model_id)
				: getDefaultAgentConfig().modelId;

	return (
		<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
			<div className="w-full max-w-4xl mx-auto px-6 py-6">
				{/* Back navigation */}
				<PageBackLink href="/dashboard/automations" label="Automations" className="mb-3" />

				{/* Header */}
				<div className="flex items-center gap-3 mb-6">
					<InlineEdit
						value={automation.name}
						onSave={handleNameSave}
						className="min-w-0"
						displayClassName="text-lg font-semibold tracking-tight text-foreground hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
						inputClassName="text-lg font-semibold tracking-tight h-auto py-0.5 px-1 -mx-1 max-w-md"
					/>

					<div className="flex items-center gap-2 ml-2">
						<StatusDot status={automation.enabled ? "active" : "paused"} />
						<Switch
							checked={automation.enabled}
							onCheckedChange={(checked) => handleUpdate({ enabled: checked })}
							disabled={!readiness.ready && !automation.enabled}
						/>
						<span className="text-sm">{automation.enabled ? "Active" : "Paused"}</span>
					</div>

					<TooltipProvider delayDuration={300}>
						<Tooltip>
							<TooltipTrigger asChild>
								<Link href={`/dashboard/automations/${id}/events`} className="ml-1">
									<Button variant="ghost" size="sm" className="h-7 gap-1.5 text-sm">
										<History className="h-3.5 w-3.5" />
										Events
									</Button>
								</Link>
							</TooltipTrigger>
							<TooltipContent side="bottom" className="max-w-[260px]">
								<p className="text-xs">
									You can view all runs for all automations at the Events page
								</p>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>

					<div className="flex items-center gap-1.5 ml-auto">
						<span className="text-xs text-muted-foreground whitespace-nowrap">
							Edited {formatRelativeTime(automation.updated_at)}
						</span>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" className="h-8 w-8">
									<MoreVertical className="h-4 w-4" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									onClick={handleRunNow}
									disabled={triggerManualRun.isPending || !readiness.ready}
								>
									{triggerManualRun.isPending ? (
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									) : (
										<Play className="h-4 w-4 mr-2" />
									)}
									Run Now
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onClick={() => setDeleteDialogOpen(true)}
									className="text-destructive"
								>
									<Trash2 className="h-4 w-4 mr-2" />
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				{/* Readiness warning */}
				{!readiness.ready && (
					<div className="rounded-xl border border-border bg-muted/30 px-4 py-3 mb-6">
						<p className="text-sm font-medium text-foreground mb-1">
							Cannot enable this automation
						</p>
						<ul className="text-xs text-muted-foreground space-y-0.5">
							{readiness.issues.map((issue) => (
								<li key={issue.message}>
									&middot;{" "}
									{issue.href ? (
										<Link
											href={issue.href}
											className="underline hover:text-foreground transition-colors"
										>
											{issue.message}
										</Link>
									) : (
										issue.message
									)}
								</li>
							))}
						</ul>
					</div>
				)}

				{/* Model & Configuration */}
				<div className="rounded-xl border border-border mb-6">
					<div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
						<span className="text-sm text-muted-foreground">Model</span>
						<ModelSelector
							modelId={resolvedModelId}
							onChange={handleModelChange}
							variant="outline"
							triggerClassName="h-8 border-0 bg-muted/30 hover:bg-muted"
						/>
					</div>
					<div className="flex items-center justify-between px-4 py-2.5">
						<span className="text-sm text-muted-foreground">Configuration</span>
						<ConfigurationSelector
							configurations={readyConfigurations}
							selectedId={automation.default_configuration_id}
							onChange={handleConfigurationChange}
							triggerClassName="border-0 bg-muted/30 hover:bg-muted"
						/>
					</div>
				</div>

				{/* Triggers */}
				<div className="mb-6">
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
						Triggers
					</p>
					<div className="flex flex-wrap items-center gap-2">
						{triggers.map((trigger) => (
							<TriggerChip
								key={trigger.id}
								trigger={trigger}
								automationId={automation.id}
								connectedProviders={connectedProviders}
								integrations={integrationsData?.integrations}
							/>
						))}
						<AddTriggerButton
							automationId={automation.id}
							connectedProviders={connectedProviders}
							integrations={integrationsData?.integrations}
						/>
					</div>
				</div>

				{/* Schedules */}
				<div className="mb-6">
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
						Schedules
					</p>
					<div className="flex flex-wrap items-center gap-2">
						{schedules.map((schedule) => (
							<TriggerChip
								key={schedule.id}
								trigger={schedule}
								automationId={automation.id}
								connectedProviders={connectedProviders}
								integrations={integrationsData?.integrations}
							/>
						))}
						<AddTriggerButton
							automationId={automation.id}
							defaultProvider="scheduled"
							label="Add schedule"
							connectedProviders={connectedProviders}
							integrations={integrationsData?.integrations}
						/>
					</div>
				</div>

				{/* Actions */}
				<div className="mb-6">
					<div className="flex items-center gap-2 mb-2">
						<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Actions
						</p>
						<span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
							<Building2 className="h-3 w-3" />
							Org-scoped
						</span>
					</div>
					<IntegrationPermissions
						automationId={id}
						enabledTools={enabledTools}
						actionModes={actionModes}
						connectedProviders={connectedProviders}
						slackInstallations={slackInstallations}
						notificationSlackInstallationId={notificationSlackInstallationId}
						onToolToggle={handleToolToggle}
						onToolConfigChange={handleToolConfigChange}
						onSlackInstallationChange={handleSlackInstallationChange}
						onPermissionChange={(key, mode) => setActionMode.mutate({ id, key, mode })}
						permissionsPending={setActionMode.isPending}
					/>
				</div>

				{/* Instructions */}
				<div className="mb-6">
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
						Instructions
					</p>
					<div className="relative rounded-xl border border-border overflow-hidden focus-within:border-foreground focus-within:ring-[0.5px] focus-within:ring-foreground transition-all">
						<Textarea
							value={instructionsValue}
							onChange={(e) => handleInstructionsChange(e.target.value)}
							placeholder="Tell the agent what to do when this automation is triggered..."
							className={cn(
								"w-full text-sm focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 border-none resize-none px-4 py-3.5 bg-transparent rounded-none min-h-0",
								"placeholder:text-muted-foreground/60",
							)}
							style={{ minHeight: "200px" }}
						/>
						<div className="flex items-center bg-muted/50 border-t border-border/50 px-4 py-2">
							<p className="text-xs text-muted-foreground">
								{hasPendingChanges || updateMutation.isPending
									? "Saving..."
									: "Auto-saves as you type"}
							</p>
						</div>
					</div>
				</div>

				{/* Advanced Prompts */}
				<CollapsibleSection title="Advanced Prompts" defaultOpen={false}>
					<div className="flex flex-col gap-4 px-4 pb-4">
						<div>
							<p className="text-xs font-medium text-muted-foreground mb-1.5">Event Filter</p>
							<div className="relative rounded-xl border border-border overflow-hidden focus-within:border-foreground focus-within:ring-[0.5px] focus-within:ring-foreground transition-all">
								<Textarea
									value={llmFilterPrompt}
									onChange={(e) => handleLlmFilterPromptChange(e.target.value)}
									placeholder="Only process events where the user was on a checkout or payment page. Ignore events from internal/admin users."
									className={cn(
										"w-full text-sm focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 border-none resize-none px-4 py-3.5 bg-transparent rounded-none min-h-0",
										"placeholder:text-muted-foreground/60",
									)}
									style={{ minHeight: "100px" }}
								/>
							</div>
						</div>
						<div>
							<p className="text-xs font-medium text-muted-foreground mb-1.5">
								Analysis Instructions
							</p>
							<div className="relative rounded-xl border border-border overflow-hidden focus-within:border-foreground focus-within:ring-[0.5px] focus-within:ring-foreground transition-all">
								<Textarea
									value={llmAnalysisPrompt}
									onChange={(e) => handleLlmAnalysisPromptChange(e.target.value)}
									placeholder="Focus on user-impacting issues. Create Linear issues for bugs that affect checkout. Send Slack notifications for high-severity errors."
									className={cn(
										"w-full text-sm focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 border-none resize-none px-4 py-3.5 bg-transparent rounded-none min-h-0",
										"placeholder:text-muted-foreground/60",
									)}
									style={{ minHeight: "100px" }}
								/>
							</div>
						</div>
					</div>
				</CollapsibleSection>

				{/* Bottom spacer */}
				<div className="h-12" />
			</div>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Automation</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete &quot;{automation.name}&quot; and all its triggers. This
							action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteMutation.mutate({ id })}
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
