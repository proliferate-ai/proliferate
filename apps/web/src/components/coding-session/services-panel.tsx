"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { formatDistanceToNow } from "date-fns";
import {
	ChevronLeft,
	ExternalLink,
	Loader2,
	Play,
	RefreshCw,
	RotateCw,
	Square,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import type { ServiceInfo } from "./runtime/use-services";
import {
	useExposePort,
	useRestartService,
	useServiceList,
	useStopService,
} from "./runtime/use-services";

const ServiceLogViewer = dynamic(
	() => import("./service-log-viewer").then((m) => m.ServiceLogViewer),
	{ ssr: false },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serviceStatusToDot(status: ServiceInfo["status"]): "active" | "stopped" | "error" {
	if (status === "running") return "active";
	if (status === "error") return "error";
	return "stopped";
}

function formatUptime(service: ServiceInfo): string {
	if (service.status === "running" && service.startedAt) {
		const ts = service.startedAt < 1e12 ? service.startedAt * 1000 : service.startedAt;
		return `Uptime: ${formatDistanceToNow(new Date(ts))}`;
	}
	if (service.status === "error" && service.startedAt) {
		const ts = service.startedAt < 1e12 ? service.startedAt * 1000 : service.startedAt;
		return `Crashed ${formatDistanceToNow(new Date(ts), { addSuffix: true })}`;
	}
	return "Stopped";
}

// ---------------------------------------------------------------------------
// ServiceRow
// ---------------------------------------------------------------------------

function ServiceRow({
	service,
	isActionLoading,
	exposedPort,
	previewUrl,
	onViewLogs,
	onStop,
	onRestart,
}: {
	service: ServiceInfo;
	isActionLoading: boolean;
	exposedPort: number | null;
	previewUrl?: string | null;
	onViewLogs: () => void;
	onStop: () => void;
	onRestart: () => void;
}) {
	const openUrl = usePreviewPanelStore((s) => s.openUrl);

	return (
		<div className="px-3 py-2.5 hover:bg-muted/50 transition-colors">
			{/* Row 1: status dot + name + uptime + actions */}
			<div className="flex items-center gap-2">
				<StatusDot status={serviceStatusToDot(service.status)} size="sm" />
				<Button
					variant="ghost"
					size="sm"
					className="h-auto p-0 text-sm font-medium justify-start min-w-0 truncate hover:underline hover:bg-transparent"
					onClick={onViewLogs}
				>
					{service.name}
				</Button>
				<span className="text-xs text-muted-foreground ml-auto shrink-0">
					{formatUptime(service)}
				</span>
				<div className="flex items-center gap-0.5 shrink-0">
					{isActionLoading ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
					) : (
						<>
							{service.status === "running" ? (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onStop}>
											<Square className="h-3 w-3" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Stop</TooltipContent>
								</Tooltip>
							) : (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRestart}>
											<Play className="h-3 w-3" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Start</TooltipContent>
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
			{/* Row 2: command + port / preview link */}
			<div className="flex items-center gap-2 mt-0.5 pl-4">
				<span className="text-xs text-muted-foreground truncate">{service.command}</span>
				{exposedPort && previewUrl && service.status === "running" && (
					<>
						<span className="text-xs text-muted-foreground shrink-0">port {exposedPort}</span>
						<Button
							variant="ghost"
							size="sm"
							className="h-5 text-[11px] gap-1 px-1.5 text-muted-foreground hover:text-foreground shrink-0"
							onClick={() => openUrl(previewUrl)}
						>
							<ExternalLink className="h-3 w-3" />
							Preview
						</Button>
					</>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// ServicesPanel
// ---------------------------------------------------------------------------

interface ServicesPanelProps {
	sessionId: string;
	previewUrl?: string | null;
}

export function ServicesPanel({ sessionId, previewUrl }: ServicesPanelProps) {
	const { data, isLoading, error, refetch } = useServiceList(sessionId);
	const stopService = useStopService(sessionId);
	const restartService = useRestartService(sessionId);
	const exposePort = useExposePort(sessionId);

	const [selectedService, setSelectedService] = useState<string | null>(null);
	const [portInput, setPortInput] = useState("");

	const services = data?.services ?? [];
	const exposedPort = data?.exposedPort ?? null;

	const actionLoadingName = stopService.isPending
		? (stopService.variables as string | undefined)
		: restartService.isPending
			? (restartService.variables as Pick<ServiceInfo, "name" | "command" | "cwd"> | undefined)
					?.name
			: null;

	const handleStop = (name: string) => {
		stopService.mutate(name, {
			onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to stop service"),
		});
	};

	const handleRestart = (service: ServiceInfo) => {
		restartService.mutate(service, {
			onError: (err) =>
				toast.error(err instanceof Error ? err.message : "Failed to restart service"),
		});
	};

	const handleExpose = () => {
		const port = Number.parseInt(portInput, 10);
		if (Number.isNaN(port) || port < 1 || port > 65535) return;
		exposePort.mutate(port, {
			onSuccess: () => setPortInput(""),
			onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to expose port"),
		});
	};

	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex flex-col h-full">
				{/* Header */}
				<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
					<div className="flex items-center gap-2 min-w-0">
						{selectedService ? (
							<>
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
								<StatusDot
									status={serviceStatusToDot(
										services.find((s) => s.name === selectedService)?.status ?? "stopped",
									)}
									size="sm"
								/>
								<span className="text-sm font-medium truncate">{selectedService} logs</span>
							</>
						) : (
							<span className="text-sm font-medium">Services</span>
						)}
					</div>
					{!selectedService && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
									<RefreshCw className="h-3.5 w-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Refresh</TooltipContent>
						</Tooltip>
					)}
				</div>

				{/* Content */}
				<div className="flex-1 min-h-0">
					{selectedService ? (
						<ServiceLogViewer sessionId={sessionId} serviceName={selectedService} />
					) : isLoading ? (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						</div>
					) : error ? (
						<div className="px-3 py-4 text-sm text-destructive">
							{error instanceof Error ? error.message : "Failed to load services"}
						</div>
					) : services.length === 0 ? (
						<div className="px-3 py-8 text-center text-sm text-muted-foreground">
							No services running
						</div>
					) : (
						<div className="overflow-y-auto h-full divide-y divide-border/50">
							{services.map((svc) => (
								<ServiceRow
									key={svc.name}
									service={svc}
									isActionLoading={actionLoadingName === svc.name}
									exposedPort={exposedPort}
									previewUrl={previewUrl}
									onViewLogs={() => setSelectedService(svc.name)}
									onStop={() => handleStop(svc.name)}
									onRestart={() => handleRestart(svc)}
								/>
							))}
						</div>
					)}
				</div>

				{/* Footer */}
				{!selectedService && services.length > 0 && (
					<div className="border-t shrink-0">
						{/* Expose port */}
						<div className="flex items-center gap-2 px-3 py-2">
							<Input
								type="number"
								value={portInput}
								onChange={(e) => setPortInput(e.target.value)}
								placeholder={exposedPort ? `port ${exposedPort}` : "Port (e.g. 3000)"}
								className="h-7 text-xs flex-1"
								min={1}
								max={65535}
								onKeyDown={(e) => e.key === "Enter" && handleExpose()}
							/>
							<Button
								size="sm"
								className="h-7 text-xs"
								onClick={handleExpose}
								disabled={exposePort.isPending || !portInput}
							>
								{exposePort.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Expose"}
							</Button>
						</div>
						<div className="px-3 py-1 text-xs text-muted-foreground">
							{services.length} service{services.length !== 1 ? "s" : ""}
							{exposedPort !== null && ` \u00B7 port ${exposedPort}`}
						</div>
					</div>
				)}
			</div>
		</TooltipProvider>
	);
}
