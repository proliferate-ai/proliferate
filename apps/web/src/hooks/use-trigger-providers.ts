"use client";

import { orpc } from "@/lib/orpc";
import { useQuery } from "@tanstack/react-query";

export interface TriggerProviderMetadata {
	name: string;
	description: string;
	icon: string;
}

export interface TriggerProviderInfo {
	id: string;
	provider: string;
	triggerType?: "webhook" | "polling";
	metadata: TriggerProviderMetadata;
	configSchema: unknown;
}

export interface TriggerProvidersResponse {
	providers: Record<string, TriggerProviderInfo>;
}

export function useTriggerProviders() {
	return useQuery({
		...orpc.triggers.providers.queryOptions({ input: undefined }),
		staleTime: 5 * 60 * 1000,
	});
}
