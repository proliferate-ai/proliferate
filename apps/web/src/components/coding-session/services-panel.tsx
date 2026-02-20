"use client";

import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Loader2, Play, RefreshCw, RotateCw, Square } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import { PanelShell } from "./panel-shell";
import type { ServiceInfo } from "./runtime/use-services";
import { useRestartService, useServiceList, useStopService } from "./runtime/use-services";

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

// ---------------------------------------------------------------------------
// ServicesPanel
// ---------------------------------------------------------------------------

interface ServicesPanelProps {
	sessionId: string;
}

export function ServicesPanel({ sessionId }: ServicesPanelProps) {
	const { data, isLoading, error, refetch } = useServiceList(sessionId);
	const stopService = useStopService(sessionId);
	const restartService = useRestartService(sessionId);

	const [activeServices, setActiveServices] = useState<Set<string>>(new Set());

	const services = data?.services ?? [];

	const toggleService = (name: string) => {
		setActiveServices((prev) => {
			const next = new Set(prev);
			if (next.has(name)) {
				next.delete(name);
			} else {
				next.add(name);
			}
			return next;
		});
	};

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

	const panelActions = (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
					<RefreshCw className="h-3.5 w-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Refresh</TooltipContent>
		</Tooltip>
	);

	return (
		<PanelShell title="Services" actions={panelActions} noPadding>
			<div className="flex flex-col h-full">
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : error ? (
					<div className="px-3 py-4 text-sm text-destructive">
						{error instanceof Error ? error.message : "Failed to load services"}
					</div>
				) : services.length === 0 ? (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-muted-foreground">No services running</p>
					</div>
				) : (
					<>
						{/* Service tabs */}
						<div className="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto shrink-0">
							{services.map((svc) => (
								<button
									key={svc.name}
									type="button"
									onClick={() => toggleService(svc.name)}
									className={cn(
										"inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
										activeServices.has(svc.name)
											? "bg-secondary text-secondary-foreground"
											: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
									)}
								>
									<StatusDot status={serviceStatusToDot(svc.status)} size="sm" />
									{svc.name}
								</button>
							))}
						</div>

						{/* Log panes */}
						<div className="flex-1 min-h-0">
							{activeServices.size === 0 ? (
								<div className="flex items-center justify-center h-full">
									<p className="text-sm text-muted-foreground">
										Select a service above to view logs
									</p>
								</div>
							) : (
								<div className="flex h-full divide-x divide-border">
									{services
										.filter((svc) => activeServices.has(svc.name))
										.map((svc) => (
											<div key={svc.name} className="flex-1 min-w-0 flex flex-col">
												<div className="flex items-center justify-between px-2 py-1 border-b border-border/50 shrink-0">
													<span className="text-xs font-medium truncate">{svc.name}</span>
													<div className="flex items-center gap-0.5">
														{svc.status === "running" ? (
															<Tooltip>
																<TooltipTrigger asChild>
																	<Button
																		variant="ghost"
																		size="icon"
																		className="h-5 w-5"
																		onClick={() => handleStop(svc.name)}
																	>
																		<Square className="h-2.5 w-2.5" />
																	</Button>
																</TooltipTrigger>
																<TooltipContent>Stop</TooltipContent>
															</Tooltip>
														) : (
															<Tooltip>
																<TooltipTrigger asChild>
																	<Button
																		variant="ghost"
																		size="icon"
																		className="h-5 w-5"
																		onClick={() => handleRestart(svc)}
																	>
																		<Play className="h-2.5 w-2.5" />
																	</Button>
																</TooltipTrigger>
																<TooltipContent>Start</TooltipContent>
															</Tooltip>
														)}
														<Tooltip>
															<TooltipTrigger asChild>
																<Button
																	variant="ghost"
																	size="icon"
																	className="h-5 w-5"
																	onClick={() => handleRestart(svc)}
																>
																	<RotateCw className="h-2.5 w-2.5" />
																</Button>
															</TooltipTrigger>
															<TooltipContent>Restart</TooltipContent>
														</Tooltip>
													</div>
												</div>
												<div className="flex-1 min-h-0">
													<ServiceLogViewer sessionId={sessionId} serviceName={svc.name} />
												</div>
											</div>
										))}
								</div>
							)}
						</div>
					</>
				)}
			</div>
		</PanelShell>
	);
}
