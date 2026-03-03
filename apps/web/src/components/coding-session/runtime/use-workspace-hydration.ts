"use client";

import { GATEWAY_URL } from "@/lib/infra/gateway";
import type { PreviewPort } from "@proliferate/shared/contracts";
import { useQuery } from "@tanstack/react-query";
import { useWsToken } from "./use-ws-token";

// ---------------------------------------------------------------------------
// G8: Initial hydration — fetch baseline daemon state before WebSocket deltas
// ---------------------------------------------------------------------------

interface DaemonHealthResponse {
	ok: boolean;
	uptime?: number;
}

interface PreviewPortsResponse {
	ports: PreviewPort[];
}

/**
 * Fetch daemon health as a readiness probe.
 * Returns `true` once the daemon is reachable through the gateway proxy.
 */
export function useDaemonHealth(sessionId: string | undefined) {
	const { token } = useWsToken();
	const canFetch = !!sessionId && !!token && !!GATEWAY_URL;

	return useQuery<DaemonHealthResponse>({
		queryKey: ["daemon-health", sessionId],
		queryFn: async () => {
			const url = `${GATEWAY_URL}/proliferate/v1/sessions/${sessionId}/daemon/health`;
			const res = await fetch(url, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		},
		enabled: canFetch,
		staleTime: 30_000,
		retry: 2,
		retryDelay: 2000,
	});
}

/**
 * Fetch the list of exposed preview ports (G8 baseline).
 * These are used to determine if preview iframes can be shown.
 */
export function usePreviewPorts(sessionId: string | undefined) {
	const { token } = useWsToken();
	const canFetch = !!sessionId && !!token && !!GATEWAY_URL;

	return useQuery<PreviewPortsResponse>({
		queryKey: ["preview-ports", sessionId],
		queryFn: async () => {
			const url = `${GATEWAY_URL}/proliferate/v1/sessions/${sessionId}/preview/ports`;
			const res = await fetch(url, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		},
		enabled: canFetch,
		staleTime: 15_000,
		retry: 1,
	});
}
