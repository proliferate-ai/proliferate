"use client";

import { ConnectionCard } from "@/components/integrations/connection-card";
import type { Provider } from "@/components/integrations/provider-icon";
import { SettingsSection } from "@/components/settings/settings-row";
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
import { orpc } from "@/lib/orpc";
import type { IntegrationWithCreator } from "@proliferate/shared";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus } from "lucide-react";
import { useState } from "react";

const PROVIDERS: Provider[] = ["github", "sentry", "linear"];

export default function ConnectionsPage() {
	const queryClient = useQueryClient();
	const [showSlackConnectForm, setShowSlackConnectForm] = useState(false);
	const [slackConnectChannelName, setSlackConnectChannelName] = useState("");

	// Nango connect hook for Linear/Sentry
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

	// GitHub App connect hook
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

	// Combined connect/disconnect functions
	const connect = async (provider: Provider) => {
		const useNango = shouldUseNangoForProvider(provider);
		if (useNango) {
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

	// Fetch integrations using oRPC hook
	const { data: integrationsData, isLoading } = useIntegrations();

	// Fetch Slack status using oRPC hook
	const { data: slackStatus } = useSlackStatus();

	// Slack mutations using oRPC hooks
	const slackDisconnect = useSlackDisconnect();
	const slackConnect = useSlackConnect();

	const integrations = integrationsData?.integrations ?? [];

	// Group integrations by provider
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
		window.location.href = `/api/integrations/slack/oauth?returnUrl=${encodeURIComponent("/settings/connections")}`;
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

	if (isLoading) {
		return (
			<div className="py-8 text-center">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-10">
			<SettingsSection title="Integrations">
				<div className="space-y-3">
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

						{/* Slack Connect support channel */}
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
				</div>
			</SettingsSection>
		</div>
	);
}
