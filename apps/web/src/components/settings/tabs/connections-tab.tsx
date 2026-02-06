"use client";

import { ConnectionCard } from "@/components/integrations/connection-card";
import type { Provider } from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import {
	useIntegrations,
	useSlackConnect,
	useSlackDisconnect,
	useSlackStatus,
} from "@/hooks/use-integrations";
import { getProviderFromIntegrationId } from "@/hooks/use-nango-connect";
import { CheckCircle2, Plus } from "lucide-react";
import { useState } from "react";

const PROVIDERS: Provider[] = ["github", "sentry", "linear"];

export interface ConnectionsTabProps {
	connect: (provider: Provider) => Promise<void>;
	disconnect: (provider: Provider, integrationId: string) => Promise<void>;
	loadingProvider: Provider | null;
}

export function ConnectionsTab({ connect, disconnect, loadingProvider }: ConnectionsTabProps) {
	const [showSlackConnectForm, setShowSlackConnectForm] = useState(false);
	const [slackConnectChannelName, setSlackConnectChannelName] = useState("");

	// Fetch all integrations with full details
	const { data: integrationsData } = useIntegrations();

	// Fetch Slack status separately (it uses different tracking)
	const { data: slackStatus } = useSlackStatus();

	// Slack mutations
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
		{} as Record<Provider, (typeof integrations)[number][]>,
	);

	const handleSlackConnect = () => {
		window.location.href = `/api/integrations/slack/oauth?returnUrl=${encodeURIComponent("/dashboard")}`;
	};

	const handleSlackDisconnect = async () => {
		try {
			await slackDisconnect.mutateAsync({});
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

	return (
		<div className="space-y-4">
			<div className="mb-4">
				<Text variant="h4" className="text-lg">
					Connections
				</Text>
				<Text variant="body" color="muted" className="text-sm">
					Connect external services to enable integrations.
				</Text>
			</div>

			{PROVIDERS.map((provider) => {
				const providerIntegrations = integrationsByProvider[provider];
				const hasConnection = providerIntegrations.length > 0;

				if (!hasConnection) {
					// Show single "not connected" card
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

				// Show a card for each connection
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

			{/* Slack Connection (separate from Nango integrations) */}
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
							<div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
								<div>
									<Text variant="small" className="font-medium">
										Support Channel
									</Text>
									<Text variant="small" color="muted">
										#{slackStatus.supportChannel.channelName}
									</Text>
								</div>
								<CheckCircle2 className="h-4 w-4 text-green-500" />
							</div>
						) : showSlackConnectForm ? (
							<div className="p-3 bg-muted/30 rounded-lg space-y-3">
								<Text variant="small" className="font-medium">
									Create Support Channel
								</Text>
								<Text variant="small" color="muted">
									Get a dedicated Slack Connect channel for support from our team.
								</Text>
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
	);
}
