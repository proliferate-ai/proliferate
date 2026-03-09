"use client";

import { type Provider, ProviderIcon } from "@/components/integrations/provider-icon";
import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
	AvailableSessionAction,
	AvailableSessionIntegration,
} from "@/hooks/actions/use-actions";
import { cn } from "@/lib/display/utils";
import { ChevronDown, ChevronRight, Loader2, Plug } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type CapabilityMode = "allow" | "require_approval" | "deny";

export type WorkerCapabilityDraft = {
	capabilityKey: string;
	mode: CapabilityMode;
	origin?: string;
};

interface WorkerActionSelectorProps {
	/** Current capability overrides for this worker */
	value: WorkerCapabilityDraft[];
	/** Called when capabilities change */
	onChange: (value: WorkerCapabilityDraft[]) => void;
	/** Available integrations + actions from the gateway */
	availableIntegrations: AvailableSessionIntegration[];
	/** Whether the action catalog is loading */
	isLoadingActions?: boolean;
	disabled?: boolean;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const RISK_LABELS: Record<string, string> = {
	read: "Read",
	write: "Write",
	danger: "Danger",
};

const MODE_LABELS: Record<CapabilityMode, string> = {
	allow: "Allow",
	require_approval: "Require approval",
	deny: "Deny",
};

function defaultModeForRisk(riskLevel: string): CapabilityMode {
	if (riskLevel === "read") return "allow";
	return "require_approval";
}

function capabilityKey(integration: string, actionName: string): string {
	return `${integration}.${actionName}`;
}

function providerFromIntegration(integration: string): Provider | undefined {
	const known: Record<string, Provider> = {
		github: "github",
		linear: "linear",
		sentry: "sentry",
		slack: "slack",
		jira: "jira",
		posthog: "posthog",
	};
	return known[integration];
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

export function WorkerActionSelector({
	value,
	onChange,
	availableIntegrations,
	isLoadingActions,
	disabled,
}: WorkerActionSelectorProps) {
	const [expandedIntegrations, setExpandedIntegrations] = useState<Set<string>>(new Set());

	// Build a lookup from capabilityKey → mode
	const capabilityMap = useMemo(() => {
		const map = new Map<string, CapabilityMode>();
		for (const cap of value) {
			map.set(cap.capabilityKey, cap.mode);
		}
		return map;
	}, [value]);

	const toggleExpanded = useCallback((integrationKey: string) => {
		setExpandedIntegrations((prev) => {
			const next = new Set(prev);
			if (next.has(integrationKey)) {
				next.delete(integrationKey);
			} else {
				next.add(integrationKey);
			}
			return next;
		});
	}, []);

	// Check if an integration has any actions enabled (not denied)
	const isIntegrationEnabled = useCallback(
		(integration: AvailableSessionIntegration) => {
			return integration.actions.some((action) => {
				const key = capabilityKey(integration.integration, action.name);
				const mode = capabilityMap.get(key);
				// If no override, use default (which is allow for read, require_approval for write)
				return mode !== "deny";
			});
		},
		[capabilityMap],
	);

	// Toggle all actions in an integration on/off
	const toggleIntegration = useCallback(
		(integration: AvailableSessionIntegration, enabled: boolean) => {
			const newValue = [...value];
			for (const action of integration.actions) {
				const key = capabilityKey(integration.integration, action.name);
				const idx = newValue.findIndex((c) => c.capabilityKey === key);
				if (enabled) {
					// Remove deny overrides (fall back to default mode)
					if (idx >= 0 && newValue[idx].mode === "deny") {
						newValue.splice(idx, 1);
					}
				} else {
					// Set all to deny
					if (idx >= 0) {
						newValue[idx] = { ...newValue[idx], mode: "deny" };
					} else {
						newValue.push({
							capabilityKey: key,
							mode: "deny",
							origin: "coworker-settings",
						});
					}
				}
			}
			onChange(newValue);
		},
		[value, onChange],
	);

	// Update mode for a single action
	const updateActionMode = useCallback(
		(integration: string, actionName: string, mode: CapabilityMode) => {
			const key = capabilityKey(integration, actionName);
			const newValue = [...value];
			const idx = newValue.findIndex((c) => c.capabilityKey === key);
			if (idx >= 0) {
				newValue[idx] = { ...newValue[idx], mode };
			} else {
				newValue.push({
					capabilityKey: key,
					mode,
					origin: "coworker-settings",
				});
			}
			onChange(newValue);
		},
		[value, onChange],
	);

	if (isLoadingActions) {
		return (
			<div className="rounded-lg border border-border bg-card px-4 py-6 flex items-center justify-center gap-2">
				<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
				<span className="text-sm text-muted-foreground">Loading available actions...</span>
			</div>
		);
	}

	if (availableIntegrations.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-card px-4 py-6">
				<div className="flex flex-col items-center gap-2 text-center">
					<Plug className="h-5 w-5 text-muted-foreground/40" />
					<p className="text-sm text-muted-foreground">
						No integrations connected. Connect integrations to enable actions.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
			{availableIntegrations.map((integration) => {
				const isExpanded = expandedIntegrations.has(integration.integration);
				const enabled = isIntegrationEnabled(integration);
				const provider = providerFromIntegration(integration.integration);
				const enabledCount = integration.actions.filter((a) => {
					const key = capabilityKey(integration.integration, a.name);
					return capabilityMap.get(key) !== "deny";
				}).length;

				return (
					<div key={integration.integrationId ?? integration.integration}>
						{/* Integration header row */}
						<div className="flex items-center gap-3 px-4 py-3">
							<button
								type="button"
								className="flex items-center gap-3 flex-1 min-w-0 text-left"
								onClick={() => toggleExpanded(integration.integration)}
								disabled={disabled}
							>
								{isExpanded ? (
									<ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
								) : (
									<ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
								)}
								{provider && (
									<ProviderIcon provider={provider} size="sm" className="h-4 w-4 shrink-0" />
								)}
								<span className="text-sm font-medium text-foreground truncate">
									{integration.displayName || integration.integration}
								</span>
								<span className="text-xs text-muted-foreground shrink-0">
									{enabledCount}/{integration.actions.length} actions
								</span>
							</button>
							<Switch
								checked={enabled}
								onCheckedChange={(checked) => toggleIntegration(integration, checked)}
								disabled={disabled}
							/>
						</div>

						{/* Expanded action list */}
						{isExpanded && (
							<div className="border-t border-border/50 bg-muted/20">
								{integration.actions.map((action) => (
									<ActionRow
										key={action.name}
										action={action}
										mode={capabilityMap.get(capabilityKey(integration.integration, action.name))}
										defaultMode={defaultModeForRisk(action.riskLevel)}
										onModeChange={(mode) =>
											updateActionMode(integration.integration, action.name, mode)
										}
										disabled={disabled}
									/>
								))}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

// --------------------------------------------------------------------------
// Action row
// --------------------------------------------------------------------------

function ActionRow({
	action,
	mode,
	defaultMode,
	onModeChange,
	disabled,
}: {
	action: AvailableSessionAction;
	mode: CapabilityMode | undefined;
	defaultMode: CapabilityMode;
	onModeChange: (mode: CapabilityMode) => void;
	disabled?: boolean;
}) {
	const effectiveMode = mode ?? defaultMode;
	const isDenied = effectiveMode === "deny";

	return (
		<div className={cn("flex items-center gap-3 px-4 py-2 pl-11", isDenied && "opacity-50")}>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="text-sm text-foreground">{action.name}</span>
					<RiskBadge riskLevel={action.riskLevel} />
				</div>
				{action.description && (
					<p className="text-xs text-muted-foreground truncate mt-0.5">{action.description}</p>
				)}
			</div>
			<Select
				value={effectiveMode}
				onValueChange={(v: CapabilityMode) => onModeChange(v)}
				disabled={disabled}
			>
				<SelectTrigger className="h-7 w-[160px] text-xs">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="allow">{MODE_LABELS.allow}</SelectItem>
					<SelectItem value="require_approval">{MODE_LABELS.require_approval}</SelectItem>
					<SelectItem value="deny">{MODE_LABELS.deny}</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

// --------------------------------------------------------------------------
// Risk badge
// --------------------------------------------------------------------------

function RiskBadge({ riskLevel }: { riskLevel: string }) {
	return (
		<Badge
			variant="outline"
			className={cn(
				"text-[10px] px-1.5 py-0 h-4 font-normal",
				riskLevel === "read" && "text-muted-foreground border-border",
				riskLevel === "write" && "text-warning border-warning/30",
				riskLevel === "danger" && "text-destructive border-destructive/30",
			)}
		>
			{RISK_LABELS[riskLevel] ?? riskLevel}
		</Badge>
	);
}
