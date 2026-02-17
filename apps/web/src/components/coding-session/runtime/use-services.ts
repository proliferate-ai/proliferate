"use client";

import { GATEWAY_URL } from "@/lib/gateway";
import { useCallback, useEffect, useRef, useState } from "react";
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

export interface UseServicesResult {
	services: ServiceInfo[];
	exposedPort: number | null;
	loading: boolean;
	error: string | null;
	actionLoading: string | null;
	selectedService: string | null;
	logContent: string;
	logEndRef: React.RefObject<HTMLDivElement | null>;
	portInput: string;
	exposing: boolean;
	setPortInput: (v: string) => void;
	selectService: (name: string | null) => void;
	refresh: () => Promise<void>;
	handleStop: (name: string) => Promise<void>;
	handleRestart: (service: ServiceInfo) => Promise<void>;
	handleExpose: () => Promise<void>;
}

function devtoolsUrl(sessionId: string, token: string, path: string): string {
	return `${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/mcp${path}`;
}

export function useServices(sessionId: string): UseServicesResult {
	const { token } = useWsToken();

	const [services, setServices] = useState<ServiceInfo[]>([]);
	const [exposedPort, setExposedPort] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [selectedService, setSelectedService] = useState<string | null>(null);
	const [logContent, setLogContent] = useState("");

	const eventSourceRef = useRef<EventSource | null>(null);
	const logEndRef = useRef<HTMLDivElement | null>(null);

	const [portInput, setPortInput] = useState("");
	const [exposing, setExposing] = useState(false);
	const [actionLoading, setActionLoading] = useState<string | null>(null);

	const fetchServices = useCallback(async () => {
		if (!token || !GATEWAY_URL) return;
		try {
			const res = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			setServices(data.services);
			setExposedPort(data.exposedPort);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load services");
		} finally {
			setLoading(false);
		}
	}, [sessionId, token]);

	// Poll service list
	useEffect(() => {
		fetchServices();
		const interval = setInterval(fetchServices, 5000);
		return () => clearInterval(interval);
	}, [fetchServices]);

	// SSE log streaming
	useEffect(() => {
		if (eventSourceRef.current) {
			eventSourceRef.current.close();
			eventSourceRef.current = null;
		}

		if (!selectedService || !token || !GATEWAY_URL) {
			setLogContent("");
			return;
		}

		const url = devtoolsUrl(sessionId, token, `/api/logs/${encodeURIComponent(selectedService)}`);
		const es = new EventSource(url);
		eventSourceRef.current = es;

		es.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				if (data.type === "initial") {
					setLogContent(data.content);
				} else if (data.type === "append") {
					setLogContent((prev) => prev + data.content);
				}
			} catch {
				// Ignore parse errors
			}
		};

		es.onerror = () => {
			// EventSource auto-reconnects; no action needed
		};

		return () => {
			es.close();
			eventSourceRef.current = null;
		};
	}, [selectedService, sessionId, token]);

	// Auto-scroll logs when new content arrives
	// biome-ignore lint/correctness/useExhaustiveDependencies: logContent triggers scroll on change
	useEffect(() => {
		logEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [logContent]);

	const handleStop = useCallback(
		async (name: string) => {
			if (!token || !GATEWAY_URL) return;
			setActionLoading(name);
			try {
				const res = await fetch(
					devtoolsUrl(sessionId, token, `/api/services/${encodeURIComponent(name)}`),
					{ method: "DELETE" },
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
			} catch {
				// Refresh to get actual state
			} finally {
				setActionLoading(null);
				await fetchServices();
			}
		},
		[sessionId, token, fetchServices],
	);

	const handleRestart = useCallback(
		async (service: ServiceInfo) => {
			if (!token || !GATEWAY_URL) return;
			setActionLoading(service.name);
			try {
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
			} catch {
				// Refresh to get actual state
			} finally {
				setActionLoading(null);
				await fetchServices();
			}
		},
		[sessionId, token, fetchServices],
	);

	const handleExpose = useCallback(async () => {
		const port = Number.parseInt(portInput, 10);
		if (!token || !GATEWAY_URL || Number.isNaN(port) || port < 1 || port > 65535) return;
		setExposing(true);
		try {
			const res = await fetch(devtoolsUrl(sessionId, token, "/api/expose"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ port }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setExposedPort(port);
			setPortInput("");
		} catch {
			// User can retry
		} finally {
			setExposing(false);
		}
	}, [sessionId, token, portInput]);

	return {
		services,
		exposedPort,
		loading,
		error,
		actionLoading,
		selectedService,
		logContent,
		logEndRef,
		portInput,
		exposing,
		setPortInput,
		selectService: setSelectedService,
		refresh: fetchServices,
		handleStop,
		handleRestart,
		handleExpose,
	};
}
