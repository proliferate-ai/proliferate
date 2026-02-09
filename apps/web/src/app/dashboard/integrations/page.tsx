"use client";

import { ConnectionCard } from "@/components/integrations/connection-card";
import type { Provider } from "@/components/integrations/provider-icon";
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

export default function IntegrationsPage() {
	const queryClient = useQueryClient();
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

	const { data: integrationsData, isLoading } = useIntegrations();
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

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="max-w-4xl mx-auto px-6 py-8">
				<div className="flex items-center justify-between mb-6">
					<h1 className="text-xl font-semibold">Integrations</h1>
				</div>

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
						{slackStatus && !slackStatus.configured && !slackStatus.connected && (
							<div className="rounded-lg border border-border bg-muted/30 p-3">
								<p className="text-sm text-muted-foreground">
									Slack not configured. Set{" "}
									<span className="font-mono text-xs">SLACK_CLIENT_ID</span>,{" "}
									<span className="font-mono text-xs">SLACK_CLIENT_SECRET</span>, and{" "}
									<span className="font-mono text-xs">SLACK_SIGNING_SECRET</span> in{" "}
									<span className="font-mono text-xs">.env</span>.{" "}
									<a
										href="https://docs.proliferate.com/self-hosting/slackbot"
										target="_blank"
										rel="noreferrer"
										className="underline text-foreground"
									>
										See docs
									</a>
								</p>
							</div>
						)}
						<ConnectionCard
							provider="slack"
							variant="settings"
							isConnected={slackStatus?.connected ?? false}
							connectedByName={slackStatus?.teamName}
							isLoading={slackDisconnect.isPending}
							disabled={slackStatus ? !slackStatus.configured : false}
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
				</div>
			</div>
		</div>
	);
}
