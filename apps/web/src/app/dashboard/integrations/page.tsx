"use client";

import { AdapterCard } from "@/components/integrations/adapter-card";
import { ConnectionCard } from "@/components/integrations/connection-card";
import { ConnectorForm } from "@/components/integrations/connector-form";
import { ConnectorIcon } from "@/components/integrations/connector-icon";
import { ConnectorRow } from "@/components/integrations/connector-row";
import type { Provider } from "@/components/integrations/provider-icon";
import { QuickSetupForm } from "@/components/integrations/quick-setup-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useGitHubAppConnect } from "@/hooks/use-github-app-connect";
import {
	useIntegrations,
	useSlackConnect,
	useSlackDisconnect,
	useSlackStatus,
} from "@/hooks/use-integrations";
import {
	type NangoProvider,
	getProviderFromIntegrationId,
	shouldUseNangoForProvider,
	useNangoConnect,
} from "@/hooks/use-nango-connect";
import {
	useCreateOrgConnector,
	useDeleteOrgConnector,
	useOrgConnectors,
	useUpdateOrgConnector,
} from "@/hooks/use-org-connectors";
import { ACTION_ADAPTERS } from "@/lib/action-adapters";
import { orpc } from "@/lib/orpc";
import { env } from "@proliferate/environment/public";
import { CONNECTOR_PRESETS, type ConnectorConfig, type ConnectorPreset } from "@proliferate/shared";
import type { IntegrationWithCreator } from "@proliferate/shared";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Unplug } from "lucide-react";
import { useCallback, useState } from "react";

const PROVIDERS: Provider[] = ["github", "sentry", "linear"];

const quickPresets = CONNECTOR_PRESETS.filter((p) => p.quickSetup);
const advancedPresets = CONNECTOR_PRESETS.filter((p) => !p.quickSetup);

export default function IntegrationsPage() {
	const queryClient = useQueryClient();

	// ---- OAuth integration state ----
	const [showSlackConnectForm, setShowSlackConnectForm] = useState(false);
	const [slackConnectChannelName, setSlackConnectChannelName] = useState("");

	const {
		connect: nangoConnect,
		disconnect: nangoDisconnect,
		loadingProvider: nangoLoadingProvider,
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
			queryClient.invalidateQueries({ queryKey: orpc.onboarding.getStatus.key() });
		},
	});

	const connect = async (provider: Provider) => {
		if (shouldUseNangoForProvider(provider)) {
			await nangoConnect(provider as NangoProvider);
		} else {
			await githubConnect();
		}
	};

	const disconnect = async (provider: Provider, integrationId: string) => {
		if (shouldUseNangoForProvider(provider)) {
			await nangoDisconnect(provider as NangoProvider, integrationId);
		} else {
			await githubDisconnect(integrationId);
		}
	};

	const loadingProvider: Provider | null = githubLoading ? "github" : nangoLoadingProvider;

	const { data: integrationsData, isLoading: integrationsLoading } = useIntegrations();
	const { data: slackStatus } = useSlackStatus();
	const slackDisconnect = useSlackDisconnect();
	const slackConnect = useSlackConnect();

	const integrations = integrationsData?.integrations ?? [];

	const integrationsByProvider = PROVIDERS.reduce(
		(acc, provider) => {
			acc[provider] = integrations.filter((i) => {
				if (!i.integration_id) return false;
				const mappedProvider = getProviderFromIntegrationId(i.integration_id);
				return mappedProvider === provider && i.status === "active";
			});
			return acc;
		},
		{} as Record<Provider, IntegrationWithCreator[]>,
	);

	const handleSlackConnect = () => {
		window.location.href = `/api/integrations/slack/oauth?returnUrl=${encodeURIComponent("/dashboard/integrations")}`;
	};

	const handleSlackDisconnect = async () => {
		try {
			await slackDisconnect.mutateAsync({});
			queryClient.invalidateQueries({ queryKey: orpc.onboarding.getStatus.key() });
		} catch (err) {
			console.error("Failed to disconnect Slack:", err);
		}
	};

	const handleCreateSlackConnect = async () => {
		if (!slackConnectChannelName.trim()) return;
		try {
			await slackConnect.mutateAsync({
				channelName: `proliferate-${slackConnectChannelName.trim()}`,
			});
			setShowSlackConnectForm(false);
			setSlackConnectChannelName("");
		} catch (err) {
			console.error("Failed to create Slack Connect channel:", err);
		}
	};

	// ---- MCP connector state ----
	const [editingId, setEditingId] = useState<string | null>(null);
	const [advancedPreset, setAdvancedPreset] = useState<ConnectorPreset | null>(null);
	const [quickSetupPreset, setQuickSetupPreset] = useState<ConnectorPreset | null>(null);

	const { data: connectors, isLoading: connectorsLoading } = useOrgConnectors();
	const createMutation = useCreateOrgConnector();
	const updateMutation = useUpdateOrgConnector();
	const deleteMutation = useDeleteOrgConnector();

	const integrationsEnabled = env.NEXT_PUBLIC_INTEGRATIONS_ENABLED;

	const handleRemove = useCallback(
		async (id: string) => {
			await deleteMutation.mutateAsync({ id });
		},
		[deleteMutation],
	);

	const handleToggle = useCallback(
		async (connector: ConnectorConfig) => {
			await updateMutation.mutateAsync({
				id: connector.id,
				enabled: !connector.enabled,
			});
		},
		[updateMutation],
	);

	const handleSave = useCallback(
		async (connector: ConnectorConfig, isNew: boolean) => {
			if (isNew) {
				await createMutation.mutateAsync({
					name: connector.name,
					transport: connector.transport,
					url: connector.url,
					auth: connector.auth,
					riskPolicy: connector.riskPolicy,
					enabled: connector.enabled,
				});
			} else {
				await updateMutation.mutateAsync({
					id: connector.id,
					name: connector.name,
					url: connector.url,
					auth: connector.auth,
					riskPolicy: connector.riskPolicy,
					enabled: connector.enabled,
				});
			}
			setEditingId(null);
			setAdvancedPreset(null);
		},
		[createMutation, updateMutation],
	);

	// ---- Loading state ----
	if (integrationsLoading && connectorsLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	const connectorList = connectors ?? [];

	return (
		<div className="h-full overflow-y-auto">
			<div className="max-w-4xl mx-auto px-6 py-8 space-y-10">
				{/* ============================================ */}
				{/* Section 1: Integrations                      */}
				{/* ============================================ */}
				<section>
					<div className="flex items-center justify-between mb-4">
						<h1 className="text-xl font-semibold">Integrations</h1>
					</div>

					<div className="space-y-3">
						{/* OAuth connection cards */}
						{PROVIDERS.map((provider) => {
							const providerIntegrations = integrationsByProvider[provider];
							const hasConnection = providerIntegrations.length > 0;

							if (!hasConnection) {
								return (
									<ConnectionCard
										key={provider}
										provider={provider}
										variant="settings"
										isConnected={false}
										isLoading={loadingProvider === provider}
										onConnect={() => connect(provider)}
									/>
								);
							}

							return providerIntegrations.map((integration) => (
								<ConnectionCard
									key={integration.id}
									provider={provider}
									variant="settings"
									isConnected={true}
									connectedByName={integration.creator?.name}
									connectedByEmail={integration.creator?.email}
									visibility={integration.visibility as "org" | "private"}
									integrationId={integration.id}
									isLoading={loadingProvider === provider}
									onConnect={() => connect(provider)}
									onReconnect={() => connect(provider)}
									onDisconnect={() => disconnect(provider, integration.id)}
								/>
							));
						})}

						{/* Slack Connection */}
						<div className="space-y-3">
							<ConnectionCard
								provider="slack"
								variant="settings"
								isConnected={slackStatus?.connected ?? false}
								connectedByName={slackStatus?.teamName}
								isLoading={slackDisconnect.isPending}
								onConnect={handleSlackConnect}
								onReconnect={handleSlackConnect}
								onDisconnect={handleSlackDisconnect}
							/>

							{slackStatus?.connected && (
								<div className="ml-4 pl-4 border-l-2 border-border">
									{slackStatus.supportChannel ? (
										<div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
											<div>
												<p className="text-sm font-medium">Support Channel</p>
												<p className="text-xs text-muted-foreground">
													#{slackStatus.supportChannel.channelName}
												</p>
											</div>
											<CheckCircle2 className="h-4 w-4 text-green-500" />
										</div>
									) : showSlackConnectForm ? (
										<div className="p-4 bg-muted/30 rounded-lg space-y-3">
											<p className="text-sm font-medium">Create Support Channel</p>
											<p className="text-xs text-muted-foreground">
												Get a dedicated Slack Connect channel for support from our team.
											</p>
											<div className="flex items-center gap-0">
												<span className="bg-muted px-3 h-9 flex items-center text-sm text-muted-foreground border border-r-0 border-input rounded-l-md">
													proliferate-
												</span>
												<Input
													placeholder="your-company"
													value={slackConnectChannelName}
													onChange={(e) =>
														setSlackConnectChannelName(
															e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
														)
													}
													disabled={slackConnect.isPending}
													className="h-9 rounded-l-none"
												/>
											</div>
											<div className="flex gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => {
														setShowSlackConnectForm(false);
														setSlackConnectChannelName("");
													}}
													disabled={slackConnect.isPending}
												>
													Cancel
												</Button>
												<Button
													size="sm"
													onClick={handleCreateSlackConnect}
													disabled={slackConnect.isPending || !slackConnectChannelName.trim()}
												>
													{slackConnect.isPending ? "Creating..." : "Create Channel"}
												</Button>
											</div>
										</div>
									) : (
										<Button
											variant="outline"
											size="sm"
											onClick={() => setShowSlackConnectForm(true)}
											className="w-full justify-start text-muted-foreground"
										>
											<Plus className="h-4 w-4 mr-2" />
											Add Support Channel
										</Button>
									)}
								</div>
							)}
						</div>

						{/* Adapter cards (action integrations) */}
						{integrationsEnabled &&
							ACTION_ADAPTERS.map((adapter) => {
								const providerIntegrations =
									integrationsData?.byProvider[adapter.integration] ?? [];
								const activeIntegration = providerIntegrations.find((i) => i.status === "active");
								return (
									<AdapterCard
										key={adapter.integration}
										adapter={adapter}
										isConnected={!!activeIntegration}
										isLoading={nangoLoadingProvider === adapter.integration}
										onConnect={() => nangoConnect(adapter.integration)}
										onDisconnect={() => {
											if (activeIntegration) {
												nangoDisconnect(adapter.integration, activeIntegration.id);
											}
										}}
									/>
								);
							})}
					</div>
				</section>

				{/* ============================================ */}
				{/* Section 2: Tools                             */}
				{/* ============================================ */}
				<section>
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-xl font-semibold">Tools</h2>
					</div>

					{/* Add a tool - preset grid */}
					<div className="space-y-4">
						<div>
							<p className="text-sm text-muted-foreground mb-3">
								Connect remote tool servers to give your agents access to external tools.
							</p>

							<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
								{quickPresets.map((preset) => (
									<button
										key={preset.key}
										type="button"
										className="text-left p-3 rounded-lg border border-border hover:border-foreground/20 hover:bg-muted/50 transition-colors"
										onClick={() => {
											setQuickSetupPreset(preset);
											setAdvancedPreset(null);
										}}
									>
										<div className="flex items-center gap-2.5 mb-1">
											<div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted shrink-0">
												<ConnectorIcon presetKey={preset.key} size="sm" />
											</div>
											<p className="text-sm font-medium">{preset.name}</p>
										</div>
										<p className="text-xs text-muted-foreground line-clamp-2">
											{preset.description}
										</p>
									</button>
								))}

								{/* Advanced presets */}
								{advancedPresets.map((preset) => (
									<button
										key={preset.key}
										type="button"
										className="text-left p-3 rounded-lg border border-dashed border-border hover:border-foreground/20 hover:bg-muted/50 transition-colors"
										onClick={() => {
											setAdvancedPreset(preset);
											setQuickSetupPreset(null);
										}}
									>
										<div className="flex items-center gap-2.5 mb-1">
											<div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted shrink-0">
												<ConnectorIcon presetKey={preset.key} size="sm" />
											</div>
											<p className="text-sm font-medium">{preset.name}</p>
										</div>
										<p className="text-xs text-muted-foreground line-clamp-2">
											{preset.description}
										</p>
									</button>
								))}
							</div>

							{/* Quick-setup inline form */}
							{quickSetupPreset && (
								<div className="mt-3">
									<QuickSetupForm
										preset={quickSetupPreset}
										onClose={() => setQuickSetupPreset(null)}
									/>
								</div>
							)}

							{/* Advanced add form */}
							{advancedPreset && !quickSetupPreset && (
								<div className="mt-3">
									<div className="rounded-lg border border-border/80 bg-background">
										<ConnectorForm
											isNew
											preset={advancedPreset}
											onSave={handleSave}
											onCancel={() => setAdvancedPreset(null)}
										/>
									</div>
								</div>
							)}
						</div>

						{/* Connected tools */}
						<div>
							<h3 className="text-sm font-medium mb-2">Connected</h3>
							{connectorList.length === 0 ? (
								<div className="rounded-lg border border-border/80 bg-background p-6 text-center">
									<Unplug className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
									<p className="text-sm text-muted-foreground">
										No tools configured yet. Add one above to get started.
									</p>
								</div>
							) : (
								<div className="rounded-lg border border-border/80 bg-background">
									<div className="divide-y divide-border">
										{connectorList.map((c) =>
											editingId === c.id ? (
												<ConnectorForm
													key={c.id}
													initial={c}
													isNew={false}
													onSave={handleSave}
													onCancel={() => setEditingId(null)}
												/>
											) : (
												<ConnectorRow
													key={c.id}
													connector={c}
													onEdit={() => setEditingId(c.id)}
													onRemove={() => handleRemove(c.id)}
													onToggle={() => handleToggle(c)}
												/>
											),
										)}
									</div>
								</div>
							)}
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}
