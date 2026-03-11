"use client";

import { ConnectorForm } from "@/components/integrations/connector-form";
import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import { Button } from "@/components/ui/button";
import { useComposioAvailable } from "@/hooks/integrations/use-composio";
import type { ConnectorConfig, ConnectorPreset } from "@proliferate/shared";
import { CheckCircle2, Loader2 } from "lucide-react";

interface ComposioConnectTabProps {
	entry: CatalogEntry;
	preset: ConnectorPreset;
	isConnected: boolean;
	connectedMeta: string | null;
	onDisconnect: () => void;
	onSaveConnector: (connector: ConnectorConfig, isNew: boolean) => void;
	onClose: () => void;
}

export function ComposioConnectTab({
	entry,
	preset,
	isConnected,
	connectedMeta,
	onDisconnect,
	onSaveConnector,
	onClose,
}: ComposioConnectTabProps) {
	const { data: availabilityData, isLoading: isCheckingAvailability } = useComposioAvailable();
	const composioAvailable = availabilityData?.available;

	// Loading state while checking availability
	if (isCheckingAvailability) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	// Self-hosted fallback: show manual connector form
	if (composioAvailable === false) {
		return (
			<div className="space-y-4">
				<p className="text-sm text-muted-foreground">{entry.description}</p>
				<p className="text-xs text-muted-foreground">
					OAuth connection is not available. Configure this integration manually with your own MCP
					server URL and API key.
				</p>
				<ConnectorForm preset={preset} isNew onSave={onSaveConnector} onCancel={onClose} />
			</div>
		);
	}

	// Connected state
	if (isConnected) {
		return (
			<div className="space-y-4">
				<p className="text-sm text-muted-foreground">{entry.description}</p>
				<div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
					<CheckCircle2 className="h-4 w-4 text-foreground shrink-0" />
					<span className="text-sm">
						Connected{connectedMeta ? ` \u00b7 ${connectedMeta}` : ""}
					</span>
				</div>
				<div className="flex items-center gap-2 pt-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							window.location.href = buildOAuthUrl(preset.composioToolkit!);
						}}
					>
						Reconnect
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="text-destructive hover:text-destructive"
						onClick={onDisconnect}
					>
						Disconnect
					</Button>
				</div>
			</div>
		);
	}

	// Not connected — show OAuth connect button
	return (
		<div className="space-y-6">
			<p className="text-sm text-muted-foreground">{entry.description}</p>
			<div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
				<p className="text-xs font-medium text-foreground">Org scope</p>
				<p className="text-xs text-muted-foreground mt-0.5">
					Only admins can set this up for the organization.
				</p>
			</div>
			<Button
				className="w-full"
				onClick={() => {
					window.location.href = buildOAuthUrl(preset.composioToolkit!);
				}}
			>
				Connect {entry.name}
			</Button>
		</div>
	);
}

function buildOAuthUrl(toolkit: string): string {
	const params = new URLSearchParams({
		toolkit,
		returnUrl: "/dashboard/integrations",
	});
	return `/api/integrations/composio/oauth?${params.toString()}`;
}
