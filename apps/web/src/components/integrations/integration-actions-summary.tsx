"use client";

import type { Provider } from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { useActionModes } from "@/hooks/actions/use-action-modes";
import { useActionPreferenceIndex } from "@/hooks/actions/use-action-preferences";
import { useConnectorActions } from "@/hooks/integrations/use-org-connectors";
import { useSession } from "@/lib/auth/client";
import { ACTION_ADAPTERS } from "@/lib/integrations/action-adapters";
import { resolveUserToggleState } from "@/lib/integrations/action-permissions";
import { useMemo } from "react";

interface IntegrationActionsSummaryProps {
	isOAuth: boolean;
	provider: Provider | null;
	connectorId?: string;
	context: "admin" | "user";
	onOpenSettings: () => void;
}

function getSourceId(
	isOAuth: boolean,
	provider: Provider | null,
	connectorId?: string,
): string | null {
	if (isOAuth && provider) {
		return provider;
	}
	if (connectorId) {
		return `connector:${connectorId}`;
	}
	return null;
}

export function IntegrationActionsSummary({
	isOAuth,
	provider,
	connectorId,
	context,
	onOpenSettings,
}: IntegrationActionsSummaryProps) {
	const { data: authSession } = useSession();
	const { data: actionModesData } = useActionModes();
	const actionModes = actionModesData?.modes ?? {};
	const preferenceIndex = useActionPreferenceIndex();
	const { data: connectorActionsData, isLoading: connectorActionsLoading } =
		useConnectorActions(connectorId);

	const sourceId = getSourceId(isOAuth, provider, connectorId);

	const actionIds = useMemo(() => {
		if (isOAuth && provider) {
			const adapter = ACTION_ADAPTERS.find((entry) => entry.integration === provider);
			return adapter?.actions.map((action) => action.name) ?? [];
		}
		return connectorActionsData?.actions?.map((action) => action.name) ?? [];
	}, [isOAuth, provider, connectorActionsData?.actions]);

	if (!sourceId) {
		return null;
	}

	if (!isOAuth && connectorActionsLoading) {
		return (
			<p className="text-[11px] text-muted-foreground" aria-live="polite">
				Loading actions...
			</p>
		);
	}

	if (actionIds.length === 0) {
		return null;
	}

	const enabledCount = actionIds.filter((actionId) => {
		const adminActionEnabled =
			(actionModes[`${sourceId}:${actionId}`] ?? "require_approval") !== "deny";
		if (context === "admin") {
			return adminActionEnabled;
		}
		const userActionEnabled =
			sourceId && authSession?.user?.id
				? preferenceIndex.isActionEnabled(sourceId, actionId)
				: true;
		return resolveUserToggleState({
			adminActionEnabled,
			userActionEnabled,
		}).checked;
	}).length;

	return (
		<Button
			type="button"
			variant="link"
			size="sm"
			className="h-auto p-0 text-[11px] text-muted-foreground hover:text-foreground"
			onClick={(event) => {
				event.stopPropagation();
				onOpenSettings();
			}}
		>
			{enabledCount} actions configured
		</Button>
	);
}
