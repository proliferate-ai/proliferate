"use client";

import { Button } from "@/components/ui/button";
import { ExternalLink, Maximize2, Minimize2, RefreshCw } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { usePolledReadiness } from "@/hooks/use-polled-readiness";
import { GATEWAY_URL } from "@/lib/gateway";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PanelShell } from "./panel-shell";
import { useWsToken } from "./runtime/use-ws-token";

interface PreviewPanelProps {
	url: string | null;
	sessionId?: string;
	className?: string;
}

function PreviewOfflineIllustration() {
	return (
		<div className="relative mx-auto h-[66px] w-[66px]">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 66 66"
				fill="none"
				className="h-[66px] w-[66px]"
			>
				<rect
					x="8"
					y="10"
					width="50"
					height="36"
					rx="6"
					className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45"
					strokeWidth="1.5"
				/>
				<rect
					x="14"
					y="16"
					width="38"
					height="24"
					rx="3"
					className="fill-background/70 dark:fill-background/55 stroke-muted-foreground/25 dark:stroke-muted-foreground/35"
					strokeWidth="1.2"
				/>
				<circle
					cx="33"
					cy="28"
					r="6"
					className="fill-muted/45 dark:fill-muted/55 stroke-muted-foreground/35 dark:stroke-muted-foreground/45"
					strokeWidth="1.2"
				/>
				<path
					d="M33 25V28.5L36 30.5"
					className="stroke-muted-foreground/50 dark:stroke-muted-foreground/60"
					strokeWidth="1.3"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<path
					d="M26 53H40"
					className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
				<path
					d="M33 46V53"
					className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			</svg>

			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 66 66"
				fill="none"
				className="absolute inset-0 h-[66px] w-[66px] animate-spin text-muted-foreground/35 dark:text-muted-foreground/45"
				style={{ animationDuration: "6s" }}
			>
				<circle
					cx="33"
					cy="33"
					r="30"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeDasharray="4 5"
				/>
			</svg>

			<span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/60 dark:bg-muted-foreground/70 animate-pulse" />
		</div>
	);
}

export function PreviewPanel({ url, sessionId, className }: PreviewPanelProps) {
	const [isFullscreen, setIsFullscreen] = useState(false);
	const { token } = useWsToken();

	const checkFn = useCallback(async (): Promise<boolean> => {
		if (!url || !sessionId || !token) return false;
		try {
			const healthUrl = `${GATEWAY_URL}/proxy/${sessionId}/${token}/health-check?url=${encodeURIComponent(url)}`;
			const res = await fetch(healthUrl);
			const data = await res.json();
			return data.ready === true;
		} catch {
			return false;
		}
	}, [url, sessionId, token]);

	const { status, retry: handleRefresh } = usePolledReadiness({
		checkFn,
		enabled: !!url && !!sessionId && !!token,
		maxAttempts: 6,
		baseIntervalMs: 1500,
		maxIntervalMs: 5000,
	});

	// Esc key exits fullscreen
	useEffect(() => {
		if (!isFullscreen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setIsFullscreen(false);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFullscreen]);

	const handleCopyUrl = useCallback(() => {
		if (!url) return;
		navigator.clipboard.writeText(url).then(() => {
			toast.success("URL copied");
		});
	}, [url]);

	if (!url) {
		return (
			<PanelShell title="Preview" noPadding>
				<div className={cn("flex items-center justify-center h-full", className)}>
					<div className="text-center space-y-3 px-4">
						<PreviewOfflineIllustration />
						<div>
							<p className="text-sm font-medium">No Preview Available</p>
							<p className="text-xs text-muted-foreground mt-1">
								Start a dev server to see your app here
							</p>
						</div>
					</div>
				</div>
			</PanelShell>
		);
	}

	const toolbar = (
		<>
			<Button
				variant="ghost"
				size="icon"
				className="h-7 w-7"
				onClick={handleRefresh}
				title="Refresh"
			>
				<RefreshCw className={cn("h-4 w-4", status === "polling" && "animate-spin")} />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				className="h-7 w-7"
				onClick={() => setIsFullscreen(!isFullscreen)}
				title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
			>
				{isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
			</Button>
			<Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Open in new tab">
				<a href={url} target="_blank" rel="noopener noreferrer">
					<ExternalLink className="h-4 w-4" />
				</a>
			</Button>
		</>
	);

	return (
		<div
			className={cn(
				"flex flex-col h-full",
				className,
				isFullscreen && "fixed inset-0 z-50 bg-background",
			)}
		>
			<PanelShell title="Preview" noPadding actions={toolbar}>
				<div className="flex flex-col h-full">
					{/* URL bar */}
					<div className="flex items-center px-3 py-1.5 border-b bg-muted/20 shrink-0">
						<div className="flex-1 min-w-0" onClick={handleCopyUrl} title="Click to copy URL">
							<Input
								readOnly
								value={url}
								className="h-7 text-xs text-muted-foreground bg-muted/50 border-none cursor-pointer select-all focus-visible:ring-0"
							/>
						</div>
					</div>

					{/* Content */}
					<div className="flex-1 min-h-0 flex items-center justify-center relative">
						{status === "polling" && (
							<div className="text-center space-y-3 px-4">
								<PreviewOfflineIllustration />
								<div>
									<p className="text-sm font-medium">Connecting to Preview</p>
									<p className="text-xs text-muted-foreground mt-1">
										Waiting for the dev server to start...
									</p>
								</div>
							</div>
						)}

						{status === "failed" && (
							<div className="text-center space-y-3 px-4">
								<PreviewOfflineIllustration />
								<div>
									<p className="text-sm font-medium">Preview Not Ready</p>
									<p className="text-xs text-muted-foreground mt-1">
										No server is running on this port yet
									</p>
								</div>
								<Button variant="outline" size="sm" onClick={handleRefresh} className="mt-2 gap-2">
									<RefreshCw className="h-3.5 w-3.5" />
									Retry
								</Button>
							</div>
						)}

						{status === "ready" && (
							<iframe
								src={url}
								className="absolute inset-0 w-full h-full border-0"
								sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
								title="Preview"
							/>
						)}
					</div>
				</div>
			</PanelShell>
		</div>
	);
}
