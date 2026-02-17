"use client";

import { AddTriggerButton } from "@/components/automations/add-trigger-button";
import { ModelSelector } from "@/components/automations/model-selector";
import { TriggerChip } from "@/components/automations/trigger-chip";
import { PermissionControl } from "@/components/integrations/permission-control";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LinearIcon, OpenCodeIcon, SlackIcon } from "@/components/ui/icons";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAutomationActionModes, useSetAutomationActionMode } from "@/hooks/use-action-modes";
import { useAutomation, useUpdateAutomation } from "@/hooks/use-automations";
import { useSlackInstallations } from "@/hooks/use-integrations";
import { ACTION_ADAPTERS, type ActionMeta } from "@/lib/action-adapters";
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
import { HelpCircle, History, Mail, MoreVertical, Shield, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";
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
		if (key === "defaultPrebuildId") mapped.default_prebuild_id = value;
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
// Local Components
// ============================================

function SectionLabel({ label }: { label: string }) {
	return (
		<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
			{label}
		</p>
	);
}

function ToolListItem({
	icon: Icon,
	label,
	tooltip,
	enabled,
	onToggle,
	badge,
	children,
}: {
	icon: React.ElementType;
	label: string;
	tooltip?: string;
	enabled: boolean;
	onToggle: (enabled: boolean) => void;
	badge?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="border-b border-border/50 last:border-0">
			<div className="flex items-center px-3 py-2.5">
				<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
				<div className="flex min-w-0 items-center grow gap-2 px-2">
					<span className="text-sm font-medium">{label}</span>
					{tooltip && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="inline-flex cursor-help">
										<HelpCircle className="w-3.5 h-3.5 text-muted-foreground/60" />
									</span>
								</TooltipTrigger>
								<TooltipContent side="top" className="max-w-[200px]">
									<p className="text-xs">{tooltip}</p>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
					{badge && (
						<span className="inline-flex items-center text-[11px] rounded-full font-medium bg-muted/80 text-muted-foreground h-5 px-1.5">
							{badge}
						</span>
					)}
				</div>
				<Switch checked={enabled} onCheckedChange={onToggle} />
			</div>
			{enabled && children && (
				<div className="px-3 pb-3 pt-1 border-t border-border/50 bg-muted/30">{children}</div>
			)}
		</div>
	);
}

function TextAreaWithFooter({
	label,
	value,
	onChange,
	placeholder,
	footerText,
	minHeight = "150px",
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	footerText?: string;
	minHeight?: string;
}) {
	return (
		<div className="space-y-2">
			<SectionLabel label={label} />
			<div className="relative rounded-xl border border-border overflow-hidden focus-within:border-foreground focus-within:ring-[0.5px] focus-within:ring-foreground transition-all">
				<Textarea
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					className={cn(
						"w-full text-sm focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 border-none resize-none px-4 py-3.5 bg-transparent rounded-none min-h-0",
						"placeholder:text-muted-foreground/60",
					)}
					style={{ minHeight }}
				/>
				{footerText && (
					<div className="flex items-center bg-muted/50 border-t border-border/50 px-4 py-2">
						<p className="text-xs text-muted-foreground">{footerText}</p>
					</div>
				)}
			</div>
		</div>
	);
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

	// Fetch automation using oRPC
	const { data: automation, isLoading, error } = useAutomation(id);

	// Fetch Slack installations for workspace selector
	const { data: slackInstallations } = useSlackInstallations();

	// Update mutation using oRPC
	const updateMutation = useUpdateAutomation(id);

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

			// Optimistic update on list
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

			// Optimistic update on detail
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

	// Delete mutation using oRPC
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
	};

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
		handleUpdate({ enabledTools: newTools });
	};

	const hasEnabledTools =
		enabledTools.slack_notify?.enabled ||
		enabledTools.create_linear_issue?.enabled ||
		enabledTools.email_user?.enabled;

	if (isLoading) {
		return (
			<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto">
				<div className="flex flex-col grow w-full max-w-screen-xl mx-auto px-4 lg:px-8 lg:pt-8 min-h-0">
					<div className="animate-pulse space-y-6 py-8">
						<div className="h-8 w-48 bg-muted rounded" />
						<div className="flex gap-8">
							<div className="flex-1 space-y-4">
								<div className="h-48 bg-muted rounded-xl" />
								<div className="h-32 bg-muted rounded-xl" />
							</div>
							<div className="w-80 space-y-4">
								<div className="h-24 bg-muted rounded-xl" />
								<div className="h-48 bg-muted rounded-xl" />
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	}

	if (error || !automation) {
		return (
			<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto">
				<div className="flex flex-col grow w-full max-w-screen-xl mx-auto px-4 lg:px-8 py-8">
					<Text variant="body" color="destructive">
						Failed to load automation
					</Text>
				</div>
			</div>
		);
	}

	const triggers = automation.triggers ?? [];

	return (
		<div className="bg-background flex flex-col grow min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
			<div className="flex flex-col grow w-full max-w-screen-xl mx-auto px-4 lg:px-8 lg:pt-8 min-h-0">
				{/* Header */}
				<div className="flex items-center gap-3 py-4 border-b border-border/50 mb-6">
					<StatusDot status={automation.enabled ? "active" : "paused"} />
					<InlineEdit
						value={automation.name}
						onSave={handleNameSave}
						className="min-w-0"
						displayClassName="text-lg font-semibold tracking-tight text-foreground hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
						inputClassName="text-lg font-semibold tracking-tight h-auto py-0.5 px-1 -mx-1 max-w-md"
					/>
					<span className="text-xs text-muted-foreground whitespace-nowrap">
						Edited {formatRelativeTime(automation.updated_at)}
					</span>

					<div className="flex items-center gap-2 ml-auto">
						<Link href={`/dashboard/automations/${id}/events`}>
							<Button variant="outline" size="sm">
								<History className="h-3.5 w-3.5 mr-1.5" />
								Events
							</Button>
						</Link>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" className="h-8 w-8">
									<MoreVertical className="h-4 w-4" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									onClick={() => setDeleteDialogOpen(true)}
									className="text-destructive"
								>
									<Trash2 className="h-4 w-4 mr-2" />
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>

						<div className="flex items-center gap-2 pl-2 border-l border-border/50">
							<Switch
								checked={automation.enabled}
								onCheckedChange={(checked) => handleUpdate({ enabled: checked })}
							/>
							<span className="text-xs text-muted-foreground">
								{automation.enabled ? "Active" : "Paused"}
							</span>
						</div>
					</div>
				</div>

				{/* Two Column Layout */}
				<div className="w-full flex flex-col lg:flex-row grow gap-6 lg:gap-8 pb-8 min-h-min">
					{/* Left Column - Main Content */}
					<div className="relative flex-1 min-w-0">
						<div className="flex flex-col min-h-0 gap-6">
							<TextAreaWithFooter
								label="Instructions"
								value={instructionsValue}
								onChange={handleInstructionsChange}
								placeholder="Tell the agent what to do when this automation is triggered..."
								footerText={
									hasPendingChanges || updateMutation.isPending
										? "Saving..."
										: "Auto-saves as you type"
								}
								minHeight="200px"
							/>

							<TextAreaWithFooter
								label="Event Filter"
								value={llmFilterPrompt}
								onChange={handleLlmFilterPromptChange}
								placeholder="Only process events where the user was on a checkout or payment page. Ignore events from internal/admin users."
								minHeight="120px"
							/>

							{hasEnabledTools && (
								<TextAreaWithFooter
									label="Analysis Instructions"
									value={llmAnalysisPrompt}
									onChange={handleLlmAnalysisPromptChange}
									placeholder="Focus on user-impacting issues. Create Linear issues for bugs that affect checkout. Send Slack notifications for high-severity errors."
									minHeight="120px"
								/>
							)}
						</div>
					</div>

					{/* Right Column - Configuration */}
					<div className="lg:w-80 min-w-0 flex flex-col gap-5 shrink-0">
						{/* Triggers */}
						<div>
							<SectionLabel label="Triggers" />
							<div className="rounded-xl border border-border overflow-hidden">
								{triggers.map((trigger, index) => (
									<TriggerChip
										key={trigger.id}
										trigger={trigger}
										automationId={automation.id}
										variant="stacked"
										isFirst={index === 0}
										isLast={false}
									/>
								))}
								<AddTriggerButton
									automationId={automation.id}
									variant="stacked"
									isFirst={triggers.length === 0}
									isLast
								/>
							</div>
						</div>

						{/* Model */}
						<div>
							<SectionLabel label="Model" />
							<div className="rounded-xl border border-border overflow-hidden">
								<div className="flex items-center px-3 min-h-[2.75rem]">
									<ModelSelector
										modelId={
											automation.model_id && isValidModelId(automation.model_id)
												? automation.model_id
												: automation.model_id
													? parseModelId(automation.model_id)
													: getDefaultAgentConfig().modelId
										}
										onChange={handleModelChange}
										triggerClassName="w-full h-full border-0 shadow-none bg-transparent hover:bg-transparent px-0"
									/>
								</div>
							</div>
						</div>

						{/* Actions */}
						<div>
							<SectionLabel label="Actions" />
							<div className="rounded-xl border border-border overflow-hidden">
								<ToolListItem
									icon={SlackIcon}
									label="Slack"
									tooltip="Send a notification to a Slack channel when events are triggered"
									enabled={enabledTools.slack_notify?.enabled || false}
									onToggle={(checked) => handleToolToggle("slack_notify", checked)}
								>
									<div className="space-y-3">
										{slackInstallations &&
											(slackInstallations.length > 1 || notificationSlackInstallationId) && (
												<div className="space-y-1.5">
													<Label className="text-xs text-muted-foreground">Workspace</Label>
													<Select
														value={notificationSlackInstallationId ?? "auto"}
														onValueChange={(value) => {
															const installationId = value === "auto" ? null : value;
															setNotificationSlackInstallationId(installationId);
															handleUpdate({
																notificationSlackInstallationId: installationId,
															});
														}}
													>
														<SelectTrigger className="h-8">
															<SelectValue placeholder="Auto-detect" />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="auto">Auto-detect</SelectItem>
															{slackInstallations.map((inst) => (
																<SelectItem key={inst.id} value={inst.id}>
																	{inst.team_name ?? inst.team_id}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												</div>
											)}
										<div className="space-y-1.5">
											<Label className="text-xs text-muted-foreground">Channel ID</Label>
											<Input
												value={enabledTools.slack_notify?.channelId || ""}
												onChange={(e) =>
													handleToolConfigChange("slack_notify", "channelId", e.target.value)
												}
												placeholder="C01234567890"
												className="h-8"
											/>
										</div>
									</div>
								</ToolListItem>

								<ToolListItem
									icon={LinearIcon}
									label="Linear"
									tooltip="Create a Linear issue to track and manage the triggered event"
									enabled={enabledTools.create_linear_issue?.enabled || false}
									onToggle={(checked) => handleToolToggle("create_linear_issue", checked)}
								>
									<div className="space-y-1.5">
										<Label className="text-xs text-muted-foreground">Team ID</Label>
										<Input
											value={enabledTools.create_linear_issue?.teamId || ""}
											onChange={(e) =>
												handleToolConfigChange("create_linear_issue", "teamId", e.target.value)
											}
											placeholder="abc123"
											className="h-8"
										/>
									</div>
								</ToolListItem>

								<ToolListItem
									icon={Mail}
									label="Email"
									tooltip="Send an email notification about the triggered event"
									enabled={enabledTools.email_user?.enabled || false}
									onToggle={(checked) => handleToolToggle("email_user", checked)}
								>
									<div className="space-y-1.5">
										<Label className="text-xs text-muted-foreground">Recipient</Label>
										<Input
											value={enabledTools.email_user?.defaultTo || ""}
											onChange={(e) =>
												handleToolConfigChange("email_user", "defaultTo", e.target.value)
											}
											placeholder="team@example.com"
											className="h-8"
										/>
									</div>
								</ToolListItem>

								<ToolListItem
									icon={OpenCodeIcon}
									label="Agent Session"
									tooltip="Spin up an AI coding agent to investigate and fix the issue"
									enabled={enabledTools.create_session?.enabled ?? true}
									onToggle={(checked) => handleToolToggle("create_session", checked)}
									badge="Default"
								/>
							</div>
						</div>

						{/* Permissions */}
						<AutomationPermissions automationId={id} />
					</div>
				</div>

				{/* Bottom spacer */}
				<div className="h-12 shrink-0" />
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

function AutomationPermissions({ automationId }: { automationId: string }) {
	const { data: modesData } = useAutomationActionModes(automationId);
	const setActionMode = useSetAutomationActionMode(automationId);
	const modes = modesData?.modes ?? {};

	const allActions = ACTION_ADAPTERS.flatMap((adapter) =>
		adapter.actions.map((action: ActionMeta) => ({
			key: `${adapter.integration}:${action.name}`,
			name: action.name,
			integration: adapter.displayName,
			description: action.description,
			riskLevel: action.riskLevel,
		})),
	);

	return (
		<div>
			<SectionLabel label="Permissions" />
			{allActions.length === 0 ? (
				<div className="rounded-xl border border-dashed border-border/80 py-6 text-center">
					<Shield className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground/40" />
					<p className="text-xs text-muted-foreground">No actions available</p>
				</div>
			) : (
				<div className="rounded-xl border border-border overflow-hidden divide-y divide-border/50">
					{allActions.map((action) => {
						const currentMode = modes[action.key] ?? "require_approval";
						return (
							<div key={action.key} className="flex items-center justify-between px-3 py-2.5">
								<div className="min-w-0 flex-1 mr-3">
									<p className="text-xs font-medium">
										{action.integration}: {action.name}
									</p>
									<span
										className={cn(
											"inline-block mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border",
											action.riskLevel === "write"
												? "border-amber-500/30 text-amber-600 bg-amber-50 dark:bg-amber-950/30"
												: "border-border text-muted-foreground",
										)}
									>
										{action.riskLevel}
									</span>
								</div>
								<PermissionControl
									value={currentMode}
									onChange={(mode) =>
										setActionMode.mutate({ id: automationId, key: action.key, mode })
									}
									disabled={setActionMode.isPending}
								/>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
