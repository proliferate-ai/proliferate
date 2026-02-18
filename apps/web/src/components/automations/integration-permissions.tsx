"use client";

import { PermissionControl } from "@/components/integrations/permission-control";
import { LinearIcon, SentryIcon, SlackIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Mail, Plug, Shield } from "lucide-react";

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

// ============================================
// Icon resolver (maps sourceId to icon component)
// ============================================

const INTEGRATION_ICONS: Record<string, React.ElementType> = {
	linear: LinearIcon,
	sentry: SentryIcon,
};

function getIntegrationIcon(sourceId: string): React.ElementType {
	return INTEGRATION_ICONS[sourceId] ?? Plug;
}

// ============================================
// Props
// ============================================

interface IntegrationPermissionsProps {
	automationId: string;
	enabledTools: EnabledTools;
	triggers: Array<{ provider: string }>;
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
	triggers,
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
	// Fetch dynamic integration actions from backend
	const { data: integrationActions } = useAutomationIntegrationActions(automationId);

	const hasLinearTrigger = triggers.some((t) => t.provider === "linear");
	const hasSentryTrigger = triggers.some((t) => t.provider === "sentry");

	// Build permissions lookup from dynamic data
	const linearActions = integrationActions?.find((i) => i.sourceId === "linear");
	const sentryActions = integrationActions?.find((i) => i.sourceId === "sentry");

	// Additional connector integrations (MCP, future)
	const connectorIntegrations =
		integrationActions?.filter((i) => i.sourceId !== "linear" && i.sourceId !== "sentry") ?? [];

	const slackConnected = connectedProviders.has("slack");
	const linearConnected = connectedProviders.has("linear");

	return (
		<div className="flex flex-col gap-3">
			{/* Slack */}
			<IntegrationCard
				icon={SlackIcon}
				name="Slack"
				enabled={enabledTools.slack_notify?.enabled || false}
				onToggle={(enabled) => onToolToggle("slack_notify", enabled)}
				disabled={!slackConnected}
				disabledMessage="Connect Slack in Settings to use this tool"
			>
				<div className="flex flex-col gap-3">
					{slackInstallations &&
						(slackInstallations.length > 1 || notificationSlackInstallationId) && (
							<div className="flex flex-col gap-1.5">
								<Label className="text-xs text-muted-foreground">Workspace</Label>
								<Select
									value={notificationSlackInstallationId ?? "auto"}
									onValueChange={(value) =>
										onSlackInstallationChange(value === "auto" ? null : value)
									}
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
			</IntegrationCard>

			{/* Linear */}
			<IntegrationCard
				icon={LinearIcon}
				name="Linear"
				enabled={enabledTools.create_linear_issue?.enabled || false}
				onToggle={(enabled) => onToolToggle("create_linear_issue", enabled)}
				disabled={!linearConnected}
				disabledMessage="Connect Linear in Settings to use this tool"
				footer={
					linearActions ? (
						<ActionPermissionsList
							integration="linear"
							actions={linearActions.actions}
							actionModes={actionModes}
							onPermissionChange={onPermissionChange}
							disabled={permissionsPending}
						/>
					) : undefined
				}
			>
				<div className="flex flex-col gap-1.5">
					<Label className="text-xs text-muted-foreground">Team ID</Label>
					<Input
						value={enabledTools.create_linear_issue?.teamId || ""}
						onChange={(e) => onToolConfigChange("create_linear_issue", "teamId", e.target.value)}
						placeholder="abc123"
						className="h-8"
					/>
				</div>
			</IntegrationCard>

			{/* Email — always available (internal service) */}
			<IntegrationCard
				icon={Mail}
				name="Email"
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
			{hasSentryTrigger && sentryActions && (
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
							actions={sentryActions.actions}
							actionModes={actionModes}
							onPermissionChange={onPermissionChange}
							disabled={permissionsPending}
						/>
					</div>
				</div>
			)}

			{/* Dynamic connector integrations (MCP, future) */}
			{connectorIntegrations.map((integration) => {
				const Icon = getIntegrationIcon(integration.sourceId);
				return (
					<div
						key={integration.sourceId}
						className="rounded-xl border border-border overflow-hidden"
					>
						<div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/50 bg-muted/30">
							<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
							<div className="flex flex-col min-w-0">
								<span className="text-sm font-medium">{integration.displayName}</span>
								<span className="text-xs text-muted-foreground">Connected via MCP</span>
							</div>
						</div>
						<div className="p-3">
							<ActionPermissionsList
								integration={integration.sourceId}
								actions={integration.actions}
								actionModes={actionModes}
								onPermissionChange={onPermissionChange}
								disabled={permissionsPending}
							/>
						</div>
					</div>
				);
			})}
		</div>
	);
}

// ============================================
// Sub-components
// ============================================

function IntegrationCard({
	icon: Icon,
	name,
	enabled,
	onToggle,
	children,
	footer,
	disabled,
	disabledMessage,
}: {
	icon: React.ElementType;
	name: string;
	enabled: boolean;
	onToggle: (enabled: boolean) => void;
	children?: React.ReactNode;
	/** Rendered independently of the enabled toggle (e.g. permissions from triggers) */
	footer?: React.ReactNode;
	/** When true, the toggle is disabled and the card shows a connection prompt */
	disabled?: boolean;
	/** Message shown when the integration is not connected */
	disabledMessage?: string;
}) {
	return (
		<div
			className={cn("rounded-xl border border-border overflow-hidden", disabled && "opacity-60")}
		>
			<div className="flex items-center px-3 py-2 border-b border-border/50">
				<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
				<span className="text-sm font-medium min-w-0 px-2 grow">{name}</span>
				<Switch checked={enabled} onCheckedChange={onToggle} disabled={disabled} />
			</div>
			{disabled && disabledMessage && (
				<div className="px-3 py-2 text-xs text-muted-foreground">{disabledMessage}</div>
			)}
			{!disabled && enabled && children && (
				<div className="p-3 border-t border-border/50 bg-muted/20">{children}</div>
			)}
			{footer && <div className="p-3 border-t border-border/50">{footer}</div>}
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
