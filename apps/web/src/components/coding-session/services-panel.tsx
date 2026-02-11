"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GATEWAY_URL } from "@/lib/gateway";
import { cn } from "@/lib/utils";
import { ChevronLeft, Circle, Loader2, RefreshCw, RotateCw, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWsToken } from "./runtime/use-ws-token";

interface ServiceInfo {
	name: string;
	command: string;
	cwd: string;
	pid: number;
	status: "running" | "stopped" | "error";
	startedAt: number;
	logFile: string;
}

interface ServicesPanelProps {
	sessionId: string;
	onClose: () => void;
}

function devtoolsUrl(sessionId: string, token: string, path: string): string {
	return `${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/mcp${path}`;
}

function ServiceRow({
	service,
	isActionLoading,
	onViewLogs,
	onStop,
	onRestart,
}: {
	service: ServiceInfo;
	isActionLoading: boolean;
	onViewLogs: () => void;
	onStop: () => void;
	onRestart: () => void;
}) {
	const statusColor =
		service.status === "running"
			? "text-green-500"
			: service.status === "error"
				? "text-destructive"
				: "text-muted-foreground";

	return (
		<div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors">
			<Circle className={cn("h-2 w-2 fill-current shrink-0", statusColor)} />
			<div className="flex-1 min-w-0">
				<button
					type="button"
					className="text-sm font-medium truncate block text-left w-full hover:underline"
					onClick={onViewLogs}
				>
					{service.name}
				</button>
				<p className="text-xs text-muted-foreground font-mono truncate">{service.command}</p>
			</div>
			<div className="flex items-center gap-1 shrink-0">
				{isActionLoading ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
				) : (
					<>
						{service.status === "running" && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onStop}>
										<Square className="h-3 w-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Stop</TooltipContent>
							</Tooltip>
						)}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRestart}>
									<RotateCw className="h-3 w-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Restart</TooltipContent>
						</Tooltip>
					</>
				)}
			</div>
		</div>
	);
}

export function ServicesPanel({ sessionId, onClose }: ServicesPanelProps) {
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

	const handleStop = async (name: string) => {
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
	};

	const handleRestart = async (service: ServiceInfo) => {
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
	};

	const handleExpose = async () => {
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
	};

	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex flex-col h-full">
				{/* Header */}
				<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
					<div className="flex items-center gap-2 min-w-0">
						{selectedService && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 shrink-0"
										onClick={() => setSelectedService(null)}
									>
										<ChevronLeft className="h-4 w-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Back to services</TooltipContent>
							</Tooltip>
						)}
						<span className="text-sm font-medium truncate">
							{selectedService ? `Logs: ${selectedService}` : "Services"}
						</span>
						{!selectedService && exposedPort !== null && (
							<span className="text-xs text-muted-foreground">port {exposedPort}</span>
						)}
					</div>
					<div className="flex items-center gap-1">
						{!selectedService && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() => fetchServices()}
									>
										<RefreshCw className="h-3.5 w-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Refresh</TooltipContent>
							</Tooltip>
						)}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
									<X className="h-4 w-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Close panel</TooltipContent>
						</Tooltip>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 min-h-0 overflow-y-auto">
					{selectedService ? (
						<pre className="text-xs font-mono p-2 whitespace-pre-wrap break-all">
							{logContent || <span className="text-muted-foreground">No logs yet</span>}
							<div ref={logEndRef} />
						</pre>
					) : loading ? (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						</div>
					) : error ? (
						<div className="px-3 py-4 text-sm text-destructive">{error}</div>
					) : services.length === 0 ? (
						<div className="px-3 py-8 text-center text-sm text-muted-foreground">
							No services running
						</div>
					) : (
						<>
							<div className="divide-y">
								{services.map((svc) => (
									<ServiceRow
										key={svc.name}
										service={svc}
										isActionLoading={actionLoading === svc.name}
										onViewLogs={() => setSelectedService(svc.name)}
										onStop={() => handleStop(svc.name)}
										onRestart={() => handleRestart(svc)}
									/>
								))}
							</div>

							{/* Expose port */}
							<div className="px-3 py-3 border-t">
								<p className="text-xs text-muted-foreground mb-2">Expose port</p>
								<div className="flex items-center gap-2">
									<Input
										type="number"
										value={portInput}
										onChange={(e) => setPortInput(e.target.value)}
										placeholder="Port (e.g. 3000)"
										className="h-7 text-xs flex-1"
										min={1}
										max={65535}
									/>
									<Button
										size="sm"
										className="h-7 text-xs"
										onClick={handleExpose}
										disabled={exposing || !portInput}
									>
										{exposing ? <Loader2 className="h-3 w-3 animate-spin" /> : "Expose"}
									</Button>
								</div>
							</div>
						</>
					)}
				</div>

				{/* Footer */}
				{!selectedService && services.length > 0 && (
					<div className="px-3 py-1.5 border-t text-xs text-muted-foreground shrink-0">
						{services.length} service
						{services.length !== 1 ? "s" : ""}
					</div>
				)}
			</div>
		</TooltipProvider>
	);
}
