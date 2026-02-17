"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ChevronLeft, Circle, Loader2, RefreshCw, RotateCw, Square, X } from "lucide-react";
import type { ServiceInfo } from "./runtime/use-services";
import { useServices } from "./runtime/use-services";

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
	const dotClass =
		service.status === "running"
			? "text-foreground"
			: service.status === "error"
				? "text-destructive"
				: "text-muted-foreground";

	return (
		<div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors">
			<Circle className={cn("h-2 w-2 fill-current shrink-0", dotClass)} />
			<div className="flex-1 min-w-0">
				<Button
					variant="ghost"
					size="sm"
					className="h-auto p-0 text-sm font-medium justify-start w-full truncate hover:underline hover:bg-transparent"
					onClick={onViewLogs}
				>
					{service.name}
				</Button>
				<p className="text-xs text-muted-foreground truncate">{service.command}</p>
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

interface ServicesPanelProps {
	sessionId: string;
	onClose: () => void;
}

export function ServicesPanel({ sessionId, onClose }: ServicesPanelProps) {
	const {
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
		selectService,
		refresh,
		handleStop,
		handleRestart,
		handleExpose,
	} = useServices(sessionId);

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
										onClick={() => selectService(null)}
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
									<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refresh()}>
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
										onViewLogs={() => selectService(svc.name)}
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
