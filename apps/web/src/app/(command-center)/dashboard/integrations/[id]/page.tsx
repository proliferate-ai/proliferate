"use client";

import { ConnectorConnectionTab } from "@/components/integrations/connector-connection-tab";
import { ConnectorIcon } from "@/components/integrations/connector-icon";
import { OAuthConnectionTab } from "@/components/integrations/oauth-connection-tab";
import { PermissionsTab } from "@/components/integrations/permissions-tab";
import { ProviderIcon, getProviderDisplayName } from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useIntegrations } from "@/hooks/integrations/use-integrations";
import { getProviderFromIntegrationId } from "@/hooks/integrations/use-nango-connect";
import { useOrgConnectors } from "@/hooks/integrations/use-org-connectors";
import { cn } from "@/lib/display/utils";
import { ACTION_ADAPTERS } from "@/lib/integrations/action-adapters";
import { ArrowLeft, Shield } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

type Tab = "connection" | "permissions";

export default function IntegrationDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const id = params.id;
	const [activeTab, setActiveTab] = useState<Tab>("connection");

	// Fetch both integrations and connectors to determine type
	const { data: integrationsData, isLoading: integrationsLoading } = useIntegrations();
	const { data: connectors, isLoading: connectorsLoading } = useOrgConnectors();

	const isLoading = integrationsLoading || connectorsLoading;

	// Find the integration or connector
	const integration = integrationsData?.integrations?.find((i) => i.id === id);
	const connector = connectors?.find((c) => c.id === id);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	if (!integration && !connector) {
		return (
			<div className="mx-auto max-w-3xl px-6 py-8">
				<p className="text-sm text-muted-foreground">Integration not found.</p>
				<Button
					variant="ghost"
					size="sm"
					className="mt-2"
					onClick={() => router.push("/dashboard/integrations")}
				>
					<ArrowLeft className="h-4 w-4 mr-1" />
					Back to integrations
				</Button>
			</div>
		);
	}

	const isOAuth = !!integration;
	const provider =
		isOAuth && integration.integration_id
			? getProviderFromIntegrationId(integration.integration_id)
			: null;
	const displayName =
		isOAuth && provider ? getProviderDisplayName(provider) : (connector?.name ?? "Integration");
	const providerHasActions = provider
		? ACTION_ADAPTERS.some((adapter) => adapter.integration === provider)
		: false;
	const showPermissionsTab = Boolean(connector) || (isOAuth && providerHasActions);

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
				{/* Header */}
				<div>
					<Button
						variant="ghost"
						onClick={() => router.push("/dashboard/integrations")}
						className="flex items-center gap-1 h-auto p-0 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
					>
						<ArrowLeft className="h-3 w-3" />
						Integrations
					</Button>
					<div className="flex items-center gap-3">
						{isOAuth && provider ? (
							<ProviderIcon provider={provider} size="md" />
						) : connector ? (
							<ConnectorIcon presetKey={connector.name.toLowerCase()} size="md" />
						) : null}
						<h1 className="text-lg font-semibold">{displayName}</h1>
					</div>
				</div>

				{/* Tabs */}
				<div className="flex gap-1 border-b border-border">
					<Button
						variant="ghost"
						onClick={() => setActiveTab("connection")}
						className={cn(
							"px-3 py-2 h-auto text-sm font-medium border-b-2 rounded-none transition-colors -mb-px",
							activeTab === "connection"
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						Connection
					</Button>
					{showPermissionsTab && (
						<Button
							variant="ghost"
							onClick={() => setActiveTab("permissions")}
							className={cn(
								"px-3 py-2 h-auto text-sm font-medium border-b-2 rounded-none transition-colors -mb-px",
								activeTab === "permissions"
									? "border-primary text-foreground"
									: "border-transparent text-muted-foreground hover:text-foreground",
							)}
						>
							<Shield className="h-3.5 w-3.5 inline mr-1.5" />
							Agent Permissions
						</Button>
					)}
				</div>

				{/* Tab content */}
				{activeTab === "connection" || !showPermissionsTab ? (
					isOAuth && provider ? (
						<OAuthConnectionTab integrationId={id} provider={provider} />
					) : connector ? (
						<ConnectorConnectionTab connector={connector} />
					) : null
				) : (
					<PermissionsTab isOAuth={isOAuth} provider={provider} connectorId={connector?.id} />
				)}
			</div>
		</div>
	);
}
