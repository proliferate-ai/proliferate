"use client";

import { useWsToken } from "@/hooks/sessions/use-ws-token";
import { GATEWAY_URL } from "@/lib/infra/gateway";
import {
	type ServiceInfo,
	createServiceLogsEventSource,
	exposePort,
	listServices,
	startService,
	stopService,
} from "@/lib/infra/gateway-devtools-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect } from "react";
import type { Terminal } from "xterm";

export type { ServiceInfo };

interface ServiceListData {
	services: ServiceInfo[];
	exposedPort: number | null;
}

export function devtoolsServicesKey(sessionId: string) {
	return ["services", sessionId] as const;
}

export function useServiceList(sessionId: string) {
	const { token } = useWsToken();

	return useQuery<ServiceListData>({
		queryKey: devtoolsServicesKey(sessionId),
		queryFn: async () => {
			if (!token || !GATEWAY_URL) {
				throw new Error("Not ready");
			}
			return listServices(sessionId, token);
		},
		enabled: !!token && !!GATEWAY_URL,
		refetchInterval: 5000,
	});
}

export function useStopService(sessionId: string) {
	const { token } = useWsToken();
	const queryClient = useQueryClient();

	return useMutation<void, Error, string>({
		mutationFn: async (name: string) => {
			if (!token || !GATEWAY_URL) {
				throw new Error("Not ready");
			}
			await stopService(sessionId, token, name);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: devtoolsServicesKey(sessionId) }),
	});
}

export function useRestartService(sessionId: string) {
	const { token } = useWsToken();
	const queryClient = useQueryClient();

	return useMutation<void, Error, Pick<ServiceInfo, "name" | "command" | "cwd">>({
		mutationFn: async (service) => {
			if (!token || !GATEWAY_URL) {
				throw new Error("Not ready");
			}
			await startService(sessionId, token, service);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: devtoolsServicesKey(sessionId) }),
	});
}

export function useExposePort(sessionId: string) {
	const { token } = useWsToken();
	const queryClient = useQueryClient();

	return useMutation<void, Error, number>({
		mutationFn: async (port: number) => {
			if (!token || !GATEWAY_URL) {
				throw new Error("Not ready");
			}
			await exposePort(sessionId, token, port);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: devtoolsServicesKey(sessionId) }),
	});
}

export function useServiceLogs(
	sessionId: string,
	serviceName: string,
	termRef: RefObject<Terminal | null>,
): void {
	const { token } = useWsToken();

	useEffect(() => {
		if (!serviceName || !token || !GATEWAY_URL) {
			return;
		}

		const eventSource = createServiceLogsEventSource(sessionId, token, serviceName);
		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				const terminal = termRef.current;
				if (!terminal) {
					return;
				}

				if (data.type === "initial") {
					terminal.clear();
					terminal.write(data.content);
				} else if (data.type === "append") {
					terminal.write(data.content);
				}
			} catch {
				// Ignore malformed log events.
			}
		};

		return () => {
			eventSource.close();
		};
	}, [sessionId, serviceName, token, termRef]);
}
