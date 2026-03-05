"use client";

import { useWsToken } from "@/hooks/sessions/use-ws-token";
import { GATEWAY_URL } from "@/lib/infra/gateway";
import { getDaemonHealth, getPreviewPorts } from "@/lib/infra/gateway-harness-client";
import { useQuery } from "@tanstack/react-query";

export function useDaemonHealth(sessionId: string | undefined) {
	const { token } = useWsToken();
	const canFetch = !!sessionId && !!token && !!GATEWAY_URL;

	return useQuery({
		queryKey: ["daemon-health", sessionId],
		queryFn: async () => getDaemonHealth(sessionId!, token!),
		enabled: canFetch,
		staleTime: 30_000,
		retry: 2,
		retryDelay: 2000,
	});
}

export function usePreviewPorts(sessionId: string | undefined) {
	const { token } = useWsToken();
	const canFetch = !!sessionId && !!token && !!GATEWAY_URL;

	return useQuery({
		queryKey: ["preview-ports", sessionId],
		queryFn: async () => getPreviewPorts(sessionId!, token!),
		enabled: canFetch,
		staleTime: 15_000,
		retry: 1,
	});
}
