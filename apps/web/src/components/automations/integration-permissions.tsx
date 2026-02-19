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
import { ChevronDown, Plug, Shield } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

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
// Icon resolver (maps sourceId to icon component)
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
	// Fetch dynamic integration actions from backend
	const { data: integrationActions, isLoading } = useAutomationIntegrationActions(automationId);

	const slackConnected = connectedProviders.has("slack");
	const linearConnected = connectedProviders.has("linear");

	// Check if there are any connected integrations or dynamic actions
	const hasSlack = slackConnected;
	const hasLinear = linearConnected;
	const hasDynamicActions = integrationActions && integrationActions.length > 0;
	const hasAnything = hasSlack || hasLinear || hasDynamicActions;

	if (isLoading) {
		return (
			<div className="rounded-xl border border-border px-4 py-6 text-center">
				<p className="text-xs text-muted-foreground">Loading actions...</p>
			</div>
		);
	}

	if (!hasAnything) {
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

	// Find dynamic action data for specific integrations
	const linearActions = integrationActions?.find((i) => i.sourceId === "linear");
	const sentryActions = integrationActions?.find((i) => i.sourceId === "sentry");

	// Other dynamic integrations (MCP, etc.)
	const otherIntegrations =
		integrationActions?.filter((i) => i.sourceId !== "linear" && i.sourceId !== "sentry") ?? [];

	return (
		<div className="flex flex-col gap-3">
			{/* Slack — only if connected */}
			{hasSlack && (
				<IntegrationCard
					icon={SlackIcon}
					name="Slack"
					enabled={enabledTools.slack_notify?.enabled || false}
					onToggle={(enabled) => onToolToggle("slack_notify", enabled)}
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
			)}

			{/* Linear — only if connected */}
			{hasLinear && (
				<IntegrationCard
					icon={LinearIcon}
					name="Linear"
					enabled={enabledTools.create_linear_issue?.enabled || false}
					onToggle={(enabled) => onToolToggle("create_linear_issue", enabled)}
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
			)}

			{/* Dynamic integration actions (Linear, Sentry, MCP, etc.) with expandable permissions */}
			{linearActions && (
				<ExpandableActionCard
					icon={LinearIcon}
					name="Linear Actions"
					actionCount={linearActions.actions.length}
				>
					<ActionPermissionsList
						integration="linear"
						actions={linearActions.actions}
						actionModes={actionModes}
						onPermissionChange={onPermissionChange}
						disabled={permissionsPending}
					/>
				</ExpandableActionCard>
			)}

			{sentryActions && (
				<ExpandableActionCard
					icon={SentryIcon}
					name="Sentry Actions"
					actionCount={sentryActions.actions.length}
				>
					<ActionPermissionsList
						integration="sentry"
						actions={sentryActions.actions}
						actionModes={actionModes}
						onPermissionChange={onPermissionChange}
						disabled={permissionsPending}
					/>
				</ExpandableActionCard>
			)}

			{/* Other dynamic connector integrations (MCP, future) */}
			{otherIntegrations.map((integration) => {
				const Icon = getIntegrationIcon(integration.sourceId);
				return (
					<ExpandableActionCard
						key={integration.sourceId}
						icon={Icon}
						name={integration.displayName}
						actionCount={integration.actions.length}
					>
						<ActionPermissionsList
							integration={integration.sourceId}
							actions={integration.actions}
							actionModes={actionModes}
							onPermissionChange={onPermissionChange}
							disabled={permissionsPending}
						/>
					</ExpandableActionCard>
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
}: {
	icon: React.ElementType;
	name: string;
	enabled: boolean;
	onToggle: (enabled: boolean) => void;
	children?: React.ReactNode;
}) {
	return (
		<div className="rounded-xl border border-border overflow-hidden">
			<div className="flex items-center px-3 py-2 border-b border-border/50">
				<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
				<span className="text-sm font-medium min-w-0 px-2 grow">{name}</span>
				<Switch checked={enabled} onCheckedChange={onToggle} />
			</div>
			{enabled && children && (
				<div className="p-3 border-t border-border/50 bg-muted/20">{children}</div>
			)}
		</div>
	);
}

function ExpandableActionCard({
	icon: Icon,
	name,
	actionCount,
	children,
}: {
	icon: React.ElementType;
	name: string;
	actionCount: number;
	children: React.ReactNode;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="rounded-xl border border-border overflow-hidden">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/30 transition-colors"
			>
				<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
				<span className="text-sm font-medium flex-1 text-left">{name}</span>
				<span className="text-xs text-muted-foreground">
					{actionCount} {actionCount === 1 ? "action" : "actions"}
				</span>
				<ChevronDown
					className={cn(
						"h-3.5 w-3.5 text-muted-foreground transition-transform",
						expanded && "rotate-180",
					)}
				/>
			</button>
			{expanded && <div className="p-3 border-t border-border/50">{children}</div>}
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
