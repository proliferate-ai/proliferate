"use client";

import { ConnectionCard } from "@/components/integrations/connection-card";
import { ConnectorForm } from "@/components/integrations/connector-form";
import { ConnectorIcon } from "@/components/integrations/connector-icon";
import { PermissionControl } from "@/components/integrations/permission-control";
import type { Provider } from "@/components/integrations/provider-icon";
import { ProviderIcon, getProviderDisplayName } from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useActionModes, useSetActionMode } from "@/hooks/use-action-modes";
import { useGitHubAppConnect } from "@/hooks/use-github-app-connect";
import { useIntegrations } from "@/hooks/use-integrations";
import {
	type NangoProvider,
	getProviderFromIntegrationId,
	shouldUseNangoForProvider,
	useNangoConnect,
} from "@/hooks/use-nango-connect";
import { useOrgConnectors, useUpdateOrgConnector } from "@/hooks/use-org-connectors";
import { ACTION_ADAPTERS, type ActionMeta } from "@/lib/action-adapters";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import type { ConnectorConfig } from "@proliferate/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Shield } from "lucide-react";
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

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
				{/* Header */}
				<div>
					<button
						type="button"
						onClick={() => router.push("/dashboard/integrations")}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
					>
						<ArrowLeft className="h-3 w-3" />
						Integrations
					</button>
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
					<button
						type="button"
						onClick={() => setActiveTab("connection")}
						className={cn(
							"px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
							activeTab === "connection"
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						Connection
					</button>
					<button
						type="button"
						onClick={() => setActiveTab("permissions")}
						className={cn(
							"px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
							activeTab === "permissions"
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<Shield className="h-3.5 w-3.5 inline mr-1.5" />
						Security Policies
					</button>
				</div>

				{/* Tab content */}
				{activeTab === "connection" ? (
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

function OAuthConnectionTab({
	integrationId,
	provider,
}: { integrationId: string; provider: Provider }) {
	const queryClient = useQueryClient();
	const { data: integrationsData } = useIntegrations();
	const integration = integrationsData?.integrations?.find((i) => i.id === integrationId);

	const {
		connect: nangoConnect,
		disconnect: nangoDisconnect,
		loadingProvider,
	} = useNangoConnect({
		flow: "connectUI",
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
		},
	});

	const {
		connect: githubConnect,
		disconnect: githubDisconnect,
		isLoading: githubLoading,
	} = useGitHubAppConnect({
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
		},
	});

	const handleConnect = async () => {
		if (shouldUseNangoForProvider(provider)) {
			await nangoConnect(provider as NangoProvider);
		} else {
			await githubConnect();
		}
	};

	const handleDisconnect = async () => {
		if (shouldUseNangoForProvider(provider)) {
			await nangoDisconnect(provider as NangoProvider, integrationId);
		} else {
			await githubDisconnect(integrationId);
		}
	};

	const isLoading = githubLoading || loadingProvider === provider;

	return (
		<div className="space-y-4">
			<ConnectionCard
				provider={provider}
				variant="settings"
				isConnected={integration?.status === "active"}
				connectedByName={integration?.creator?.name}
				connectedByEmail={integration?.creator?.email}
				visibility={(integration?.visibility as "org" | "private") ?? "org"}
				integrationId={integrationId}
				isLoading={isLoading}
				onConnect={handleConnect}
				onReconnect={handleConnect}
				onDisconnect={handleDisconnect}
			/>
		</div>
	);
}

function ConnectorConnectionTab({ connector }: { connector: ConnectorConfig }) {
	const updateMutation = useUpdateOrgConnector();
	const [editing, setEditing] = useState(false);

	const handleSave = async (updated: ConnectorConfig) => {
		await updateMutation.mutateAsync({
			id: connector.id,
			name: updated.name,
			url: updated.url,
			auth: updated.auth,
			riskPolicy: updated.riskPolicy,
			enabled: updated.enabled,
		});
		setEditing(false);
	};

	const handleToggle = async () => {
		await updateMutation.mutateAsync({ id: connector.id, enabled: !connector.enabled });
	};

	return (
		<div className="space-y-4">
			{editing ? (
				<div className="rounded-lg border border-border/80 bg-background">
					<ConnectorForm
						initial={connector}
						isNew={false}
						onSave={handleSave}
						onCancel={() => setEditing(false)}
					/>
				</div>
			) : (
				<div className="rounded-lg border border-border/80 bg-background p-4 space-y-3">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-medium">{connector.name}</h3>
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"text-xs",
									connector.enabled ? "text-green-600" : "text-muted-foreground",
								)}
							>
								{connector.enabled ? "Enabled" : "Disabled"}
							</span>
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-xs"
								onClick={handleToggle}
								disabled={updateMutation.isPending}
							>
								{connector.enabled ? "Disable" : "Enable"}
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-xs"
								onClick={() => setEditing(true)}
							>
								Edit
							</Button>
						</div>
					</div>
					<div className="text-xs text-muted-foreground space-y-1">
						<p>
							URL: <code className="font-mono">{connector.url}</code>
						</p>
						<p>Transport: {connector.transport}</p>
					</div>
				</div>
			)}
		</div>
	);
}

function PermissionsTab({
	isOAuth,
	provider,
	connectorId,
}: {
	isOAuth: boolean;
	provider: Provider | null;
	connectorId?: string;
}) {
	const { data: modesData } = useActionModes();
	const setActionMode = useSetActionMode();
	const modes = modesData?.modes ?? {};

	// For MCP connectors, fetch dynamic tools from listActions
	const { data: connectorTools, isLoading: toolsLoading } = useQuery({
		...orpc.integrations.listActions.queryOptions({
			input: { connectorId: connectorId ?? "" },
		}),
		enabled: !!connectorId,
	});

	// Build action list — static for OAuth, dynamic for MCP connectors
	let actions: {
		key: string;
		name: string;
		description: string;
		riskLevel: string;
		drifted?: boolean;
	}[] = [];

	if (isOAuth && provider) {
		const adapter = ACTION_ADAPTERS.find((a) => a.integration === provider);
		if (adapter) {
			actions = adapter.actions.map((action: ActionMeta) => ({
				key: `${provider}:${action.name}`,
				name: action.name,
				description: action.description,
				riskLevel: action.riskLevel,
			}));
		}
	} else if (connectorId && connectorTools?.tools) {
		actions = connectorTools.tools.map((tool) => ({
			key: `connector:${connectorId}:${tool.name}`,
			name: tool.name,
			description: tool.description,
			riskLevel: tool.riskLevel,
		}));
	}

	if (toolsLoading && connectorId) {
		return (
			<div className="flex items-center justify-center py-12">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	if (actions.length === 0) {
		return (
			<div className="rounded-lg border border-dashed border-border/80 py-8 text-center">
				<Shield className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
				<p className="text-sm text-muted-foreground">
					{connectorId
						? "No tools discovered. The connector may be unreachable or has no tools."
						: "No actions available for this integration."}
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<p className="text-sm text-muted-foreground">
				Control what your agents can do with this integration. Changes apply to all sessions.
			</p>

			{/* Table header */}
			<div className="rounded-lg border border-border/80 bg-background">
				<div className="grid grid-cols-[1fr_auto] items-center px-4 py-2 border-b border-border/60 text-xs text-muted-foreground font-medium">
					<span>Action</span>
					<span>Access Policy</span>
				</div>
				<div className="divide-y divide-border/60">
					{actions.map((action) => {
						const currentMode = modes[action.key] ?? "require_approval";
						const isDrifted = action.drifted;
						return (
							<div
								key={action.key}
								className={cn(
									"flex items-center justify-between px-4 py-3",
									isDrifted && "bg-amber-50/50 dark:bg-amber-950/20",
								)}
							>
								<div className="min-w-0 flex-1 mr-4">
									<div className="flex items-center gap-2">
										<p className="text-sm font-medium font-mono">{action.name}</p>
										{isDrifted && (
											<span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
												<AlertTriangle className="h-3 w-3" />
												Schema changed
											</span>
										)}
									</div>
									<p className="text-xs text-muted-foreground">{action.description}</p>
									<span
										className={cn(
											"inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border",
											action.riskLevel === "write"
												? "border-amber-500/30 text-amber-600 bg-amber-50 dark:bg-amber-950/30"
												: action.riskLevel === "danger"
													? "border-red-500/30 text-red-600 bg-red-50 dark:bg-red-950/30"
													: "border-border text-muted-foreground",
										)}
									>
										{action.riskLevel}
									</span>
								</div>
								<PermissionControl
									value={currentMode}
									onChange={(mode) => setActionMode.mutate({ key: action.key, mode })}
									disabled={setActionMode.isPending}
								/>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
