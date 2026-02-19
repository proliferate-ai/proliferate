"use client";

import { PermissionControl } from "@/components/integrations/permission-control";
import { LinearIcon, SentryIcon, SlackIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAutomationIntegrationActions } from "@/hooks/use-automations";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Plug } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

// ============================================
// Types
// ============================================

type ActionMode = "allow" | "require_approval" | "deny";

interface ActionMeta {
	name: string;
	description: string;
	riskLevel: "read" | "write";
}

interface ToolConfig {
	enabled: boolean;
	channelId?: string;
	teamId?: string;
	defaultTo?: string;
}

interface EnabledTools {
	slack_notify?: ToolConfig;
	create_linear_issue?: ToolConfig;
	create_session?: ToolConfig;
}

// ============================================
// Icon resolver
// ============================================

const INTEGRATION_ICONS: Record<string, React.ElementType> = {
	linear: LinearIcon,
	sentry: SentryIcon,
	slack: SlackIcon,
};

function getIntegrationIcon(sourceId: string): React.ElementType {
	return INTEGRATION_ICONS[sourceId] ?? Plug;
}

// ============================================
// Unified row descriptor
// ============================================

interface IntegrationRow {
	key: string;
	icon: React.ElementType;
	name: string;
	/** Built-in tool name (for toggle) */
	toolName?: keyof EnabledTools;
	/** Config popover content (rendered when enabled) */
	configContent?: React.ReactNode;
	/** Dynamic actions (permissions) */
	actions?: ActionMeta[];
	/** Integration source ID for permission keys */
	integration?: string;
}

// ============================================
// Props
// ============================================

interface IntegrationPermissionsProps {
	automationId: string;
	enabledTools: EnabledTools;
	actionModes: Record<string, ActionMode>;
	connectedProviders: Set<string>;
	slackInstallations?: Array<{ id: string; team_name: string | null; team_id: string }>;
	notificationSlackInstallationId: string | null;
	onToolToggle: (toolName: keyof EnabledTools, enabled: boolean) => void;
	onToolConfigChange: (toolName: keyof EnabledTools, key: string, value: string) => void;
	onSlackInstallationChange: (installationId: string | null) => void;
	onPermissionChange: (key: string, mode: ActionMode) => void;
	permissionsPending?: boolean;
}

// ============================================
// Component
// ============================================

export function IntegrationPermissions({
	automationId,
	enabledTools,
	actionModes,
	connectedProviders,
	slackInstallations,
	notificationSlackInstallationId,
	onToolToggle,
	onToolConfigChange,
	onSlackInstallationChange,
	onPermissionChange,
	permissionsPending,
}: IntegrationPermissionsProps) {
	const { data: integrationActions, isLoading } = useAutomationIntegrationActions(automationId);

	const slackConnected = connectedProviders.has("slack");
	const linearConnected = connectedProviders.has("linear");

	const linearActions = integrationActions?.find((i) => i.sourceId === "linear");
	const sentryActions = integrationActions?.find((i) => i.sourceId === "sentry");
	const otherIntegrations = useMemo(
		() =>
			integrationActions?.filter((i) => i.sourceId !== "linear" && i.sourceId !== "sentry") ?? [],
		[integrationActions],
	);

	// Build unified rows
	const rows: IntegrationRow[] = useMemo(() => {
		const result: IntegrationRow[] = [];

		if (slackConnected) {
			result.push({
				key: "slack",
				icon: SlackIcon,
				name: "Slack",
				toolName: "slack_notify",
				configContent: (
					<SlackConfig
						enabledTools={enabledTools}
						slackInstallations={slackInstallations}
						notificationSlackInstallationId={notificationSlackInstallationId}
						onToolConfigChange={onToolConfigChange}
						onSlackInstallationChange={onSlackInstallationChange}
					/>
				),
			});
		}

		if (linearConnected) {
			result.push({
				key: "linear",
				icon: LinearIcon,
				name: "Linear",
				toolName: "create_linear_issue",
				configContent: (
					<LinearConfig enabledTools={enabledTools} onToolConfigChange={onToolConfigChange} />
				),
				actions: linearActions?.actions,
				integration: "linear",
			});
		} else if (linearActions) {
			// Linear not connected as tool but has dynamic actions
			result.push({
				key: "linear",
				icon: LinearIcon,
				name: "Linear",
				actions: linearActions.actions,
				integration: "linear",
			});
		}

		if (sentryActions) {
			result.push({
				key: "sentry",
				icon: SentryIcon,
				name: "Sentry",
				actions: sentryActions.actions,
				integration: "sentry",
			});
		}

		for (const integration of otherIntegrations) {
			result.push({
				key: integration.sourceId,
				icon: getIntegrationIcon(integration.sourceId),
				name: integration.displayName,
				actions: integration.actions,
				integration: integration.sourceId,
			});
		}

		return result;
	}, [
		slackConnected,
		linearConnected,
		linearActions,
		sentryActions,
		otherIntegrations,
		enabledTools,
		slackInstallations,
		notificationSlackInstallationId,
		onToolConfigChange,
		onSlackInstallationChange,
	]);

	if (isLoading) {
		return (
			<div className="rounded-xl border border-border px-4 py-6 text-center">
				<p className="text-xs text-muted-foreground">Loading actions...</p>
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<div className="rounded-xl border border-border px-4 py-6 text-center">
				<p className="text-sm text-muted-foreground">No integrations connected.</p>
				<p className="text-xs text-muted-foreground mt-1">
					<Link
						href="/dashboard/integrations"
						className="underline hover:text-foreground transition-colors"
					>
						Connect integrations
					</Link>{" "}
					in Settings to enable actions.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-border overflow-hidden divide-y divide-border/50">
			{rows.map((row) => (
				<UnifiedActionRow
					key={row.key}
					row={row}
					enabledTools={enabledTools}
					actionModes={actionModes}
					onToolToggle={onToolToggle}
					onPermissionChange={onPermissionChange}
					permissionsPending={permissionsPending}
				/>
			))}
		</div>
	);
}

// ============================================
// Config sub-components (inlined in popover)
// ============================================

function SlackConfig({
	enabledTools,
	slackInstallations,
	notificationSlackInstallationId,
	onToolConfigChange,
	onSlackInstallationChange,
}: {
	enabledTools: EnabledTools;
	slackInstallations?: Array<{ id: string; team_name: string | null; team_id: string }>;
	notificationSlackInstallationId: string | null;
	onToolConfigChange: (toolName: keyof EnabledTools, key: string, value: string) => void;
	onSlackInstallationChange: (installationId: string | null) => void;
}) {
	return (
		<div className="flex flex-col gap-3 min-w-[260px]">
			{slackInstallations && (slackInstallations.length > 1 || notificationSlackInstallationId) && (
				<div className="flex flex-col gap-1.5">
					<Label className="text-xs text-muted-foreground">Workspace</Label>
					<Select
						value={notificationSlackInstallationId ?? "auto"}
						onValueChange={(value) => onSlackInstallationChange(value === "auto" ? null : value)}
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
			<div className="flex flex-col gap-1.5">
				<Label className="text-xs text-muted-foreground">Channel ID</Label>
				<Input
					value={enabledTools.slack_notify?.channelId || ""}
					onChange={(e) => onToolConfigChange("slack_notify", "channelId", e.target.value)}
					placeholder="C01234567890"
					className="h-8"
				/>
			</div>
		</div>
	);
}

function LinearConfig({
	enabledTools,
	onToolConfigChange,
}: {
	enabledTools: EnabledTools;
	onToolConfigChange: (toolName: keyof EnabledTools, key: string, value: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5 min-w-[260px]">
			<Label className="text-xs text-muted-foreground">Team ID</Label>
			<Input
				value={enabledTools.create_linear_issue?.teamId || ""}
				onChange={(e) => onToolConfigChange("create_linear_issue", "teamId", e.target.value)}
				placeholder="abc123"
				className="h-8"
			/>
		</div>
	);
}

// ============================================
// Unified action row
// ============================================

function UnifiedActionRow({
	row,
	enabledTools,
	actionModes,
	onToolToggle,
	onPermissionChange,
	permissionsPending,
}: {
	row: IntegrationRow;
	enabledTools: EnabledTools;
	actionModes: Record<string, ActionMode>;
	onToolToggle: (toolName: keyof EnabledTools, enabled: boolean) => void;
	onPermissionChange: (key: string, mode: ActionMode) => void;
	permissionsPending?: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const [configOpen, setConfigOpen] = useState(false);

	const hasActions = row.actions && row.actions.length > 0;
	const hasConfig = !!row.configContent;
	// If row has configContent, "Configure" popover includes both config + permissions
	// If row has no configContent but has actions, inline expand for permissions only
	const usePopoverForActions = hasConfig;

	// Determine enabled state
	let isEnabled: boolean;
	if (row.toolName) {
		isEnabled = enabledTools[row.toolName]?.enabled || false;
	} else if (hasActions && row.integration) {
		isEnabled = row.actions!.some((a) => {
			const key = `${row.integration}:${a.name}`;
			return (actionModes[key] ?? "require_approval") !== "deny";
		});
	} else {
		isEnabled = false;
	}

	const handleToggle = (enabled: boolean) => {
		if (row.toolName) {
			onToolToggle(row.toolName, enabled);
			// Also sync dynamic action permissions when toggling off a tool with actions
			if (!enabled && hasActions && row.integration) {
				for (const action of row.actions!) {
					const key = `${row.integration}:${action.name}`;
					onPermissionChange(key, "deny");
				}
			}
		} else if (hasActions && row.integration) {
			const mode: ActionMode = enabled ? "require_approval" : "deny";
			for (const action of row.actions!) {
				const key = `${row.integration}:${action.name}`;
				onPermissionChange(key, mode);
			}
		}
	};

	const Icon = row.icon;

	const permissionsList = hasActions && row.integration && (
		<PermissionsList
			actions={row.actions!}
			integration={row.integration}
			actionModes={actionModes}
			onPermissionChange={onPermissionChange}
			disabled={permissionsPending}
		/>
	);

	return (
		<div>
			<div className="flex items-center px-3 py-2.5">
				<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
				<span className="text-sm font-medium min-w-0 px-2 grow">{row.name}</span>

				{/* Action-only rows (no config): inline expand */}
				{!usePopoverForActions && hasActions && (
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="mr-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
					>
						{row.actions!.length} {row.actions!.length === 1 ? "action" : "actions"}
						<ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
					</button>
				)}

				{/* Rows with config: "Configure" popover includes config fields + permissions */}
				{isEnabled && hasConfig && (
					<Popover open={configOpen} onOpenChange={setConfigOpen}>
						<PopoverTrigger asChild>
							<button
								type="button"
								className="mr-2 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
							>
								Configure
								<ChevronRight className="h-3 w-3" />
							</button>
						</PopoverTrigger>
						<PopoverContent className="w-auto p-3" align="end">
							<div className="flex flex-col gap-4">
								{row.configContent}
								{permissionsList}
							</div>
						</PopoverContent>
					</Popover>
				)}

				<Switch
					checked={isEnabled}
					onCheckedChange={handleToggle}
					aria-label={`Toggle ${row.name}`}
				/>
			</div>

			{/* Inline expanded permissions (action-only rows, no config) */}
			{!usePopoverForActions && expanded && hasActions && row.integration && (
				<div className="divide-y divide-border/40">
					{row.actions!.map((action) => {
						const key = `${row.integration}:${action.name}`;
						const currentMode = actionModes[key] ?? "require_approval";
						return (
							<div
								key={key}
								className="flex items-center justify-between px-3 py-2 pl-10 hover:bg-muted/30 transition-colors"
							>
								<div className="min-w-0 flex-1 mr-3">
									<span className="text-xs font-medium">{action.name}</span>
									<span
										className={cn(
											"ml-2 text-[10px] font-medium",
											action.riskLevel === "write"
												? "text-muted-foreground"
												: "text-muted-foreground/60",
										)}
									>
										{action.riskLevel}
									</span>
								</div>
								<PermissionControl
									value={currentMode}
									onChange={(mode) => onPermissionChange(key, mode)}
									disabled={permissionsPending}
								/>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

/**
 * Reusable permissions list for the configure popover.
 */
function PermissionsList({
	actions,
	integration,
	actionModes,
	onPermissionChange,
	disabled,
}: {
	actions: ActionMeta[];
	integration: string;
	actionModes: Record<string, ActionMode>;
	onPermissionChange: (key: string, mode: ActionMode) => void;
	disabled?: boolean;
}) {
	return (
		<div>
			<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
				Permissions
			</p>
			<div className="divide-y divide-border/40">
				{actions.map((action) => {
					const key = `${integration}:${action.name}`;
					const currentMode = actionModes[key] ?? "require_approval";
					return (
						<div
							key={key}
							className="flex items-center justify-between py-2 hover:bg-muted/30 transition-colors"
						>
							<div className="min-w-0 flex-1 mr-3">
								<span className="text-xs font-medium">{action.name}</span>
								<span
									className={cn(
										"ml-2 text-[10px] font-medium",
										action.riskLevel === "write"
											? "text-muted-foreground"
											: "text-muted-foreground/60",
									)}
								>
									{action.riskLevel}
								</span>
							</div>
							<PermissionControl
								value={currentMode}
								onChange={(mode) => onPermissionChange(key, mode)}
								disabled={disabled}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}
