"use client";

import type { Provider } from "@/components/integrations/provider-icon";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useActionModes, useSetActionMode } from "@/hooks/actions/use-action-modes";
import {
	useActionPreferenceIndex,
	useSetActionPreference,
} from "@/hooks/actions/use-action-preferences";
import { useOrgMembersAndInvitations } from "@/hooks/org/use-orgs";
import { useActiveOrganization, useSession } from "@/lib/auth/client";
import { hasRoleOrHigher } from "@/lib/auth/roles";
import { ACTION_ADAPTERS, type ActionMeta } from "@/lib/integrations/action-adapters";
import { Shield } from "lucide-react";
import { useMemo, useState } from "react";

interface PermissionsTabProps {
	isOAuth: boolean;
	provider: Provider | null;
	connectorId?: string;
}

type ConfigureContext = "admin" | "user";

function getSourceIdFromProps(props: PermissionsTabProps): string | null {
	if (props.isOAuth && props.provider) {
		return props.provider;
	}
	if (props.connectorId) {
		return `connector:${props.connectorId}`;
	}
	return null;
}

function buildActions(props: PermissionsTabProps) {
	if (!props.isOAuth || !props.provider) {
		return [] as Array<{ key: string; name: string; description: string; riskLevel: string }>;
	}

	const adapter = ACTION_ADAPTERS.find((entry) => entry.integration === props.provider);
	if (!adapter) {
		return [] as Array<{ key: string; name: string; description: string; riskLevel: string }>;
	}

	return adapter.actions.map((action: ActionMeta) => ({
		key: `${props.provider}:${action.name}`,
		name: action.name,
		description: action.description,
		riskLevel: action.riskLevel,
	}));
}

export function PermissionsTab({ isOAuth, provider, connectorId }: PermissionsTabProps) {
	const { data: authSession } = useSession();
	const { data: activeOrg } = useActiveOrganization();
	const { data: orgData } = useOrgMembersAndInvitations(activeOrg?.id);
	const isAdmin =
		(orgData?.currentUserRole && hasRoleOrHigher(orgData.currentUserRole, "admin")) ?? false;

	const { data: modesData } = useActionModes();
	const setActionMode = useSetActionMode();
	const setActionPreference = useSetActionPreference();
	const preferenceIndex = useActionPreferenceIndex();
	const modes = modesData?.modes ?? {};
	const sourceId = getSourceIdFromProps({ isOAuth, provider, connectorId });

	const actions = useMemo(
		() => buildActions({ isOAuth, provider, connectorId }),
		[isOAuth, provider, connectorId],
	);
	const [configureContext, setConfigureContext] = useState<ConfigureContext>("admin");

	if (actions.length === 0 && !connectorId) {
		return (
			<div className="rounded-lg border border-dashed border-border/80 py-8 text-center">
				<Shield className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
				<p className="text-sm text-muted-foreground">No actions available for this integration.</p>
			</div>
		);
	}

	if (actions.length === 0 && connectorId) {
		return (
			<div className="rounded-lg border border-dashed border-border/80 py-8 text-center">
				<Shield className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
				<p className="text-sm text-muted-foreground">
					Action-level settings for custom connectors are shown when tool definitions are available.
				</p>
			</div>
		);
	}

	const showConfigureSwitch = isAdmin;
	const effectiveContext: ConfigureContext = showConfigureSwitch ? configureContext : "user";

	return (
		<div className="space-y-3">
			<p className="text-sm text-muted-foreground">
				Control what actions are enabled. Changes become defaults for your sessions.
			</p>
			{showConfigureSwitch && (
				<div className="rounded-lg border border-border/80 bg-card px-3 py-2">
					<div className="flex items-center justify-between gap-2">
						<Label className="text-xs text-muted-foreground">
							{effectiveContext === "admin"
								? "Configure as admin (controls what end users see)"
								: "Configure as user (for your own actions)"}
						</Label>
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">Admin</span>
							<Switch
								checked={effectiveContext === "user"}
								onCheckedChange={(checked) => setConfigureContext(checked ? "user" : "admin")}
							/>
							<span className="text-xs text-muted-foreground">User</span>
						</div>
					</div>
				</div>
			)}
			<div className="rounded-lg border border-border/80 bg-background divide-y divide-border/60">
				{actions.map((action) => {
					const actionEnabledByAdmin = (modes[action.key] ?? "require_approval") !== "deny";
					const actionId = action.name;
					const actionEnabledByUser =
						sourceId && authSession?.user?.id
							? preferenceIndex.isActionEnabled(sourceId, actionId)
							: true;
					const checked = effectiveContext === "admin" ? actionEnabledByAdmin : actionEnabledByUser;

					const disabled =
						(effectiveContext === "admin" && setActionMode.isPending) ||
						(effectiveContext === "user" && setActionPreference.isPending);

					const handleToggle = (nextEnabled: boolean) => {
						if (!sourceId) {
							return;
						}

						if (effectiveContext === "admin") {
							setActionMode.mutate({
								key: `${sourceId}:${actionId}`,
								mode: nextEnabled ? "allow" : "deny",
							});
							return;
						}

						setActionPreference.mutate({
							sourceId,
							actionId,
							enabled: nextEnabled,
						});
					};

					return (
						<div key={action.key} className="flex items-center justify-between px-4 py-3">
							<div className="min-w-0 flex-1 mr-4">
								<p className="text-sm font-medium">{action.name}</p>
								<p className="text-xs text-muted-foreground">{action.description}</p>
								<span className="inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-border text-muted-foreground">
									{action.riskLevel}
								</span>
							</div>
							<div className="flex items-center gap-2">
								<span className="text-xs text-muted-foreground">{checked ? "On" : "Off"}</span>
								<Switch checked={checked} onCheckedChange={handleToggle} disabled={disabled} />
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
