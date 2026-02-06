"use client";

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
		queryKey: ["trigger-providers"],
		queryFn: async (): Promise<TriggerProvidersResponse> => {
			const response = await fetch("/api/trigger-providers");
			if (!response.ok) {
				const text = await response.text();
				throw new Error(text || "Failed to load trigger providers");
			}
			return response.json();
		},
		staleTime: 5 * 60 * 1000,
	});
}
