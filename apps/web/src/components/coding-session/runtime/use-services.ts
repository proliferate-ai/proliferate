"use client";

import { GATEWAY_URL } from "@/lib/gateway";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect } from "react";
import type { Terminal } from "xterm";
import { useWsToken } from "./use-ws-token";

export interface ServiceInfo {
	name: string;
	command: string;
	cwd: string;
	pid: number;
	status: "running" | "stopped" | "error";
	startedAt: number;
	logFile: string;
}

interface ServiceListData {
	services: ServiceInfo[];
	exposedPort: number | null;
}

function devtoolsUrl(sessionId: string, token: string, path: string): string {
	return `${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/mcp${path}`;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useServiceList(sessionId: string) {
	const { token } = useWsToken();

	return useQuery({
		queryKey: ["services", sessionId],
		queryFn: async (): Promise<ServiceListData> => {
			if (!GATEWAY_URL || !token) throw new Error("Not ready");
			const res = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			return { services: data.services, exposedPort: data.exposedPort };
		},
		enabled: !!token && !!GATEWAY_URL && !!sessionId,
		refetchInterval: 5_000,
		staleTime: 3_000,
	});
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useStopService(sessionId: string) {
	const { token } = useWsToken();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (serviceName: string) => {
			if (!GATEWAY_URL || !token) throw new Error("Not ready");
			const res = await fetch(
				devtoolsUrl(sessionId, token, `/api/services/${encodeURIComponent(serviceName)}`),
				{ method: "DELETE" },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["services", sessionId] });
		},
	});
}

export function useRestartService(sessionId: string) {
	const { token } = useWsToken();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (service: Pick<ServiceInfo, "name" | "command" | "cwd">) => {
			if (!GATEWAY_URL || !token) throw new Error("Not ready");
			const res = await fetch(devtoolsUrl(sessionId, token, "/api/services"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: service.name,
					command: service.command,
					cwd: service.cwd,
				}),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["services", sessionId] });
		},
	});
}

export function useExposePort(sessionId: string) {
	const { token } = useWsToken();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (port: number) => {
			if (!GATEWAY_URL || !token) throw new Error("Not ready");
			const res = await fetch(devtoolsUrl(sessionId, token, "/api/expose"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ port }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["services", sessionId] });
		},
	});
}

// ---------------------------------------------------------------------------
// SSE log streaming → xterm
// ---------------------------------------------------------------------------

export function useServiceLogs(
	sessionId: string,
	serviceName: string | null,
	termRef: RefObject<Terminal | null>,
) {
	const { token } = useWsToken();

	useEffect(() => {
		if (!serviceName || !token || !GATEWAY_URL) return;

		const url = devtoolsUrl(sessionId, token, `/api/logs/${encodeURIComponent(serviceName)}`);
		const es = new EventSource(url);

		es.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				if (data.type === "initial") {
					termRef.current?.clear();
					termRef.current?.write(data.content);
				} else if (data.type === "append") {
					termRef.current?.write(data.content);
				}
			} catch {
				// Ignore parse errors
			}
		};

		return () => {
			es.close();
		};
	}, [sessionId, token, serviceName, termRef]);
}
