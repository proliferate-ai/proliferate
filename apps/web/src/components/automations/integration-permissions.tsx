"use client";

import { PermissionControl } from "@/components/integrations/permission-control";
import { LinearIcon, SentryIcon, SlackIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Mail, Shield } from "lucide-react";

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
	email_user?: ToolConfig;
	create_session?: ToolConfig;
}

interface TriggerInfo {
	provider: string;
}

// ============================================
// Adapter action metadata (stable, only 2 adapters)
// ============================================

const LINEAR_ACTIONS: ActionMeta[] = [
	{ name: "list_issues", description: "List issues", riskLevel: "read" },
	{ name: "get_issue", description: "Get a specific issue", riskLevel: "read" },
	{ name: "create_issue", description: "Create a new issue", riskLevel: "write" },
	{ name: "update_issue", description: "Update an existing issue", riskLevel: "write" },
	{ name: "add_comment", description: "Add a comment to an issue", riskLevel: "write" },
];

const SENTRY_ACTIONS: ActionMeta[] = [
	{ name: "list_issues", description: "List issues", riskLevel: "read" },
	{ name: "get_issue", description: "Get details of a specific issue", riskLevel: "read" },
	{
		name: "list_issue_events",
		description: "List events for a specific issue",
		riskLevel: "read",
	},
	{ name: "get_event", description: "Get details of a specific event", riskLevel: "read" },
	{ name: "update_issue", description: "Update an issue", riskLevel: "write" },
];

// ============================================
// Props
// ============================================

interface IntegrationPermissionsProps {
	automationId: string;
	enabledTools: EnabledTools;
	triggers: TriggerInfo[];
	actionModes: Record<string, ActionMode>;
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
	enabledTools,
	triggers,
	actionModes,
	slackInstallations,
	notificationSlackInstallationId,
	onToolToggle,
	onToolConfigChange,
	onSlackInstallationChange,
	onPermissionChange,
	permissionsPending,
}: IntegrationPermissionsProps) {
	const hasLinearTool = enabledTools.create_linear_issue?.enabled;
	const hasLinearTrigger = triggers.some((t) => t.provider === "linear");
	const showLinear = hasLinearTool || hasLinearTrigger;

	const hasSentryTrigger = triggers.some((t) => t.provider === "sentry");

	return (
		<div className="flex flex-col gap-3">
			{/* Slack */}
			<IntegrationCard
				icon={SlackIcon}
				name="Slack"
				description="Send notifications to a Slack channel"
				enabled={enabledTools.slack_notify?.enabled || false}
				onToggle={(enabled) => onToolToggle("slack_notify", enabled)}
			>
				<div className="flex flex-col gap-3">
					{slackInstallations &&
						(slackInstallations.length > 1 || notificationSlackInstallationId) && (
							<div className="flex flex-col gap-1.5">
								<Label className="text-xs text-muted-foreground">Workspace</Label>
								<select
									value={notificationSlackInstallationId ?? "auto"}
									onChange={(e) =>
										onSlackInstallationChange(e.target.value === "auto" ? null : e.target.value)
									}
									className="h-8 rounded-md border border-border bg-background px-2 text-sm"
								>
									<option value="auto">Auto-detect</option>
									{slackInstallations.map((inst) => (
										<option key={inst.id} value={inst.id}>
											{inst.team_name ?? inst.team_id}
										</option>
									))}
								</select>
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
			</IntegrationCard>

			{/* Linear */}
			<IntegrationCard
				icon={LinearIcon}
				name="Linear"
				description="Create and manage Linear issues"
				enabled={enabledTools.create_linear_issue?.enabled || false}
				onToggle={(enabled) => onToolToggle("create_linear_issue", enabled)}
			>
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs text-muted-foreground">Team ID</Label>
						<Input
							value={enabledTools.create_linear_issue?.teamId || ""}
							onChange={(e) => onToolConfigChange("create_linear_issue", "teamId", e.target.value)}
							placeholder="abc123"
							className="h-8"
						/>
					</div>
					{showLinear && (
						<ActionPermissionsList
							integration="linear"
							actions={LINEAR_ACTIONS}
							actionModes={actionModes}
							onPermissionChange={onPermissionChange}
							disabled={permissionsPending}
						/>
					)}
				</div>
			</IntegrationCard>

			{/* Email */}
			<IntegrationCard
				icon={Mail}
				name="Email"
				description="Send email notifications"
				enabled={enabledTools.email_user?.enabled || false}
				onToggle={(enabled) => onToolToggle("email_user", enabled)}
			>
				<div className="flex flex-col gap-1.5">
					<Label className="text-xs text-muted-foreground">Recipient</Label>
					<Input
						value={enabledTools.email_user?.defaultTo || ""}
						onChange={(e) => onToolConfigChange("email_user", "defaultTo", e.target.value)}
						placeholder="team@example.com"
						className="h-8"
					/>
				</div>
			</IntegrationCard>

			{/* Sentry (trigger-based, no tool toggle) */}
			{hasSentryTrigger && (
				<div className="rounded-xl border border-border overflow-hidden">
					<div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/50 bg-muted/30">
						<SentryIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
						<div className="flex flex-col min-w-0">
							<span className="text-sm font-medium">Sentry</span>
							<span className="text-xs text-muted-foreground">Connected via trigger</span>
						</div>
					</div>
					<div className="p-3">
						<ActionPermissionsList
							integration="sentry"
							actions={SENTRY_ACTIONS}
							actionModes={actionModes}
							onPermissionChange={onPermissionChange}
							disabled={permissionsPending}
						/>
					</div>
				</div>
			)}
		</div>
	);
}

// ============================================
// Sub-components
// ============================================

function IntegrationCard({
	icon: Icon,
	name,
	description,
	enabled,
	onToggle,
	children,
}: {
	icon: React.ElementType;
	name: string;
	description: string;
	enabled: boolean;
	onToggle: (enabled: boolean) => void;
	children: React.ReactNode;
}) {
	return (
		<div className="rounded-xl border border-border overflow-hidden">
			<div className="flex items-center px-3 py-2.5 border-b border-border/50">
				<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
				<div className="flex flex-col min-w-0 px-2 grow">
					<span className="text-sm font-medium">{name}</span>
					<span className="text-xs text-muted-foreground">{description}</span>
				</div>
				<Switch checked={enabled} onCheckedChange={onToggle} />
			</div>
			{enabled && <div className="p-3 border-t border-border/50 bg-muted/20">{children}</div>}
		</div>
	);
}

function ActionPermissionsList({
	integration,
	actions,
	actionModes,
	onPermissionChange,
	disabled,
}: {
	integration: string;
	actions: ActionMeta[];
	actionModes: Record<string, ActionMode>;
	onPermissionChange: (key: string, mode: ActionMode) => void;
	disabled?: boolean;
}) {
	return (
		<div>
			<div className="flex items-center gap-1.5 mb-2">
				<Shield className="w-3 h-3 text-muted-foreground" />
				<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					Permissions
				</span>
			</div>
			<div className="rounded-lg border border-border/60 overflow-hidden divide-y divide-border/40">
				{actions.map((action) => {
					const key = `${integration}:${action.name}`;
					const currentMode = actionModes[key] ?? "require_approval";
					return (
						<div
							key={key}
							className="flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
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
