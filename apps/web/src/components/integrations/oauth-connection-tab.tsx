"use client";

import { ConnectionCard } from "@/components/integrations/connection-card";
import type { Provider } from "@/components/integrations/provider-icon";
import { useGitHubAppConnect } from "@/hooks/integrations/use-github-app-connect";
import { useIntegrations } from "@/hooks/integrations/use-integrations";
import {
	type NangoProvider,
	shouldUseNangoForProvider,
	useNangoConnect,
} from "@/hooks/integrations/use-nango-connect";
import { orpc } from "@/lib/infra/orpc";
import { useQueryClient } from "@tanstack/react-query";

interface OAuthConnectionTabProps {
	integrationId: string;
	provider: Provider;
}

export function OAuthConnectionTab({ integrationId, provider }: OAuthConnectionTabProps) {
	const queryClient = useQueryClient();
	const { data: integrationsData } = useIntegrations();
	const integration = integrationsData?.integrations?.find((i) => i.id === integrationId);

	const {
		connect: nangoConnect,
		disconnect: nangoDisconnect,
		loadingProvider,
	} = useNangoConnect({
		flow: "auth",
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
				isLoading={isLoading}
				onConnect={handleConnect}
				onReconnect={handleConnect}
				onDisconnect={handleDisconnect}
			/>
		</div>
	);
}
