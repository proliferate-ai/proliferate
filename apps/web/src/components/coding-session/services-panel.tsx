"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { PanelShell } from "./panel-shell";
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
	return (
		<div className="px-3 py-3 hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0">
			<div className="flex items-start justify-between gap-3">
				<div className="flex flex-col min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<StatusDot status={serviceStatusToDot(service.status)} size="sm" />
						<button
							type="button"
							onClick={onViewLogs}
							className="text-sm font-medium truncate hover:underline text-left"
						>
							{service.name}
						</button>
						<span className="text-[10px] text-muted-foreground ml-1">{formatUptime(service)}</span>
					</div>
					<div className="mt-1 flex flex-col items-start gap-1.5">
						<span className="text-[10.5px] font-mono text-muted-foreground/80 truncate bg-muted/40 px-1.5 py-0.5 rounded-sm max-w-full">
							$ {service.command}
						</span>
						{service.status === "error" && (
							<button
								type="button"
								onClick={onViewLogs}
								className="inline-flex items-center gap-1.5 rounded-sm bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/20 transition-colors mt-0.5"
							>
								<span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
								Process crashed - view logs
							</button>
						)}
					</div>
				</div>
				<div className="flex items-center gap-0.5 shrink-0 bg-background rounded-md border shadow-sm p-0.5 mt-0.5">
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
	const openUrl = usePreviewPanelStore((s) => s.openUrl);
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

	const panelIcon = selectedService ? (
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
		</>
	) : undefined;

	const panelActions = !selectedService ? (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
					<RefreshCw className="h-3.5 w-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Refresh</TooltipContent>
		</Tooltip>
	) : undefined;

	const exposePortBar = !selectedService && (
		<div className="border-b shrink-0 bg-muted/10">
			<div className="px-4 py-3 flex flex-col gap-2.5">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
							Global Port Routing
						</h4>
						<p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
							Set which internal port is exposed in Preview.
						</p>
					</div>
					{exposedPort && previewUrl && (
						<Button
							variant="secondary"
							size="sm"
							className="h-7 text-xs gap-1.5 shrink-0"
							onClick={() => openUrl(previewUrl)}
						>
							Preview
							<ExternalLink className="h-3 w-3" />
						</Button>
					)}
				</div>
				<div className="flex items-center gap-2 mt-1">
					<Input
						type="number"
						value={portInput}
						onChange={(e) => setPortInput(e.target.value)}
						placeholder={
							exposedPort ? `Currently exposing port ${exposedPort}` : "Target port (e.g. 3000)"
						}
						className="h-8 text-xs flex-1 max-w-[220px] bg-background"
						min={1}
						max={65535}
						onKeyDown={(e) => e.key === "Enter" && handleExpose()}
					/>
					<Button
						size="sm"
						className="h-8 text-xs"
						onClick={handleExpose}
						disabled={exposePort.isPending || !portInput}
					>
						{exposePort.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Set Route"}
					</Button>
				</div>
			</div>
		</div>
	);

	return (
		<PanelShell
			title={selectedService ? `${selectedService} logs` : "Services"}
			icon={panelIcon}
			actions={panelActions}
			noPadding
		>
			<div className="flex flex-col h-full">
				{/* Expose port bar — always visible at top when on list view */}
				{exposePortBar}

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
						<div className="overflow-y-auto h-full">
							{services.map((svc) => (
								<ServiceRow
									key={svc.name}
									service={svc}
									isActionLoading={actionLoadingName === svc.name}
									onViewLogs={() => setSelectedService(svc.name)}
									onStop={() => handleStop(svc.name)}
									onRestart={() => handleRestart(svc)}
								/>
							))}
						</div>
					)}
				</div>

				{/* Footer — service count + exposed port info */}
				{!selectedService && services.length > 0 && (
					<div className="border-t shrink-0 px-3 py-1 text-xs text-muted-foreground">
						{services.length} service{services.length !== 1 ? "s" : ""}
						{exposedPort !== null && ` \u00B7 port ${exposedPort}`}
					</div>
				)}
			</div>
		</PanelShell>
	);
}
