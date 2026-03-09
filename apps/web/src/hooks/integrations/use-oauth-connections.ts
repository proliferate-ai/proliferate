"use client";

import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import type { Provider } from "@/components/integrations/provider-icon";
import { OAUTH_PROVIDERS } from "@/config/integrations";
import { useGitHubAppConnect } from "@/hooks/integrations/use-github-app-connect";
import {
	useIntegrations,
	useSlackConnect,
	useSlackDisconnect,
	useSlackStatus,
} from "@/hooks/integrations/use-integrations";
import {
	type NangoProvider,
	getProviderFromIntegrationId,
	shouldUseNangoForProvider,
	useNangoConnect,
} from "@/hooks/integrations/use-nango-connect";
import { orpc } from "@/lib/infra/orpc";
import type { IntegrationWithCreator } from "@proliferate/shared/contracts/integrations";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

export function useOAuthConnections() {
	const queryClient = useQueryClient();

	const {
		connect: nangoConnect,
		disconnect: nangoDisconnect,
		loadingProvider: nangoLoadingProvider,
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
			queryClient.invalidateQueries({ queryKey: orpc.onboarding.getStatus.key() });
		},
	});

	const connectOAuth = useCallback(
		async (provider: Provider) => {
			if (shouldUseNangoForProvider(provider)) {
				await nangoConnect(provider as NangoProvider);
			} else {
				await githubConnect();
			}
		},
		[nangoConnect, githubConnect],
	);

	const disconnectOAuth = useCallback(
		async (provider: Provider, integrationId: string) => {
			if (shouldUseNangoForProvider(provider)) {
				await nangoDisconnect(provider as NangoProvider, integrationId);
			} else {
				await githubDisconnect(integrationId);
			}
		},
		[nangoDisconnect, githubDisconnect],
	);

	const loadingProvider: Provider | null = githubLoading ? "github" : nangoLoadingProvider;

	const { data: integrationsData, isLoading: integrationsLoading } = useIntegrations();
	const { data: slackStatus } = useSlackStatus();
	const slackDisconnect = useSlackDisconnect();
	const slackConnect = useSlackConnect();
	const integrations = integrationsData?.integrations ?? [];

	const integrationsByProvider = useMemo(
		() =>
			OAUTH_PROVIDERS.reduce(
				(acc, provider) => {
					acc[provider] = integrations.filter((i) => {
						if (!i.integration_id) return false;
						const mappedProvider = getProviderFromIntegrationId(i.integration_id);
						return mappedProvider === provider && i.status === "active";
					});
					return acc;
				},
				{} as Record<Provider, IntegrationWithCreator[]>,
			),
		[integrations],
	);

	const handleSlackConnect = useCallback(() => {
		window.location.href = `/api/integrations/slack/oauth?returnUrl=${encodeURIComponent("/dashboard/integrations")}`;
	}, []);

	const handleSlackDisconnect = useCallback(async () => {
		await slackDisconnect.mutateAsync({});
		queryClient.invalidateQueries({ queryKey: orpc.onboarding.getStatus.key() });
	}, [slackDisconnect, queryClient]);

	const handleConnect = useCallback(
		(entry: CatalogEntry) => {
			switch (entry.type) {
				case "oauth":
					if (entry.provider) connectOAuth(entry.provider);
					break;
				case "slack":
					handleSlackConnect();
					break;
				case "mcp-preset":
					// MCP presets connect through the detail modal form
					break;
			}
		},
		[connectOAuth, handleSlackConnect],
	);

	return {
		connectOAuth,
		disconnectOAuth,
		loadingProvider,
		integrationsLoading,
		integrationsByProvider,
		allIntegrations: integrations,
		slackStatus,
		slackDisconnect,
		slackConnect,
		handleSlackConnect,
		handleSlackDisconnect,
		handleConnect,
	};
}
