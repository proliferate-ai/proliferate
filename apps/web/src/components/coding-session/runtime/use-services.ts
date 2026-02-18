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

/**
 * Fetch the service list via TanStack Query.
 */
export function useServiceList(sessionId: string) {
	const { token } = useWsToken();

	return useQuery<ServiceListData>({
		queryKey: ["services", sessionId],
		queryFn: async () => {
			if (!token || !GATEWAY_URL) throw new Error("Not ready");
			const res = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		},
		enabled: !!token && !!GATEWAY_URL,
		refetchInterval: 5000,
	});
}

/**
 * Mutation: stop a service by name.
 */
export function useStopService(sessionId: string) {
	const { token } = useWsToken();
	const qc = useQueryClient();

	return useMutation<void, Error, string>({
		mutationFn: async (name: string) => {
			if (!token || !GATEWAY_URL) throw new Error("Not ready");
			const res = await fetch(
				devtoolsUrl(sessionId, token, `/api/services/${encodeURIComponent(name)}`),
				{ method: "DELETE" },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
		},
		onSettled: () => qc.invalidateQueries({ queryKey: ["services", sessionId] }),
	});
}

/**
 * Mutation: restart (or start) a service.
 */
export function useRestartService(sessionId: string) {
	const { token } = useWsToken();
	const qc = useQueryClient();

	return useMutation<void, Error, Pick<ServiceInfo, "name" | "command" | "cwd">>({
		mutationFn: async (service) => {
			if (!token || !GATEWAY_URL) throw new Error("Not ready");
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
		onSettled: () => qc.invalidateQueries({ queryKey: ["services", sessionId] }),
	});
}

/**
 * Mutation: expose a port.
 */
export function useExposePort(sessionId: string) {
	const { token } = useWsToken();
	const qc = useQueryClient();

	return useMutation<void, Error, number>({
		mutationFn: async (port: number) => {
			if (!token || !GATEWAY_URL) throw new Error("Not ready");
			const res = await fetch(devtoolsUrl(sessionId, token, "/api/expose"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ port }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
		},
		onSettled: () => qc.invalidateQueries({ queryKey: ["services", sessionId] }),
	});
}

/**
 * SSE log streaming into an xterm Terminal ref.
 */
export function useServiceLogs(
	sessionId: string,
	serviceName: string,
	termRef: RefObject<Terminal | null>,
): void {
	const { token } = useWsToken();

	useEffect(() => {
		if (!serviceName || !token || !GATEWAY_URL) return;

		const url = devtoolsUrl(sessionId, token, `/api/logs/${encodeURIComponent(serviceName)}`);
		const es = new EventSource(url);

		es.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				const term = termRef.current;
				if (!term) return;

				if (data.type === "initial") {
					term.clear();
					term.write(data.content);
				} else if (data.type === "append") {
					term.write(data.content);
				}
			} catch {
				// Ignore parse errors
			}
		};

		return () => {
			es.close();
		};
	}, [sessionId, serviceName, token, termRef]);
}
