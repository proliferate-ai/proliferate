"use client";

import { Button } from "@/components/ui/button";
import { ExternalLink, Maximize2, Minimize2, MonitorIcon, RefreshCw } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PanelShell } from "./panel-shell";

interface PreviewPanelProps {
	url: string | null;
	className?: string;
}

export function PreviewPanel({ url, className }: PreviewPanelProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	// "checking" = polling the URL, "ready" = server is up, "unavailable" = not serving
	const [status, setStatus] = useState<"checking" | "ready" | "unavailable">("checking");
	const [refreshKey, setRefreshKey] = useState(0);

	const checkUrl = useCallback(async (targetUrl: string): Promise<boolean> => {
		try {
			const res = await fetch(targetUrl, { mode: "cors" });
			return res.ok;
		} catch {
			// CORS blocks the response — but the server DID respond, so it's up
			// A true network error (server down) would also land here, but
			// we distinguish by trying no-cors which always succeeds if reachable
			try {
				await fetch(targetUrl, { mode: "no-cors" });
				// If this didn't throw, the server is reachable
				return true;
			} catch {
				// Actual network failure — server is not reachable
				return false;
			}
		}
	}, []);

	// Poll the URL to check if the server is actually serving.
	// refreshKey is intentionally in deps to allow re-triggering via Retry button.
	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-triggers polling
	useEffect(() => {
		if (!url) return;

		let cancelled = false;
		let attempts = 0;
		const maxAttempts = 8;
		setStatus("checking");

		const poll = async () => {
			const ok = await checkUrl(url);
			if (cancelled) return;

			if (ok) {
				setStatus("ready");
				return;
			}

			attempts++;
			if (attempts >= maxAttempts) {
				setStatus("unavailable");
				return;
			}

			// Exponential backoff: 1s, 2s, 4s, 8s, 10s (capped)
			const delay = Math.min(1000 * 2 ** (attempts - 1), 10000);
			setTimeout(() => {
				if (!cancelled) poll();
			}, delay);
		};

		poll();
		return () => {
			cancelled = true;
		};
	}, [url, checkUrl, refreshKey]);

	// Esc key exits fullscreen
	useEffect(() => {
		if (!isFullscreen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setIsFullscreen(false);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFullscreen]);

	const handleRefresh = useCallback(() => {
		setRefreshKey((k) => k + 1);
	}, []);

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
						<div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
							<MonitorIcon className="h-6 w-6 text-muted-foreground" />
						</div>
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
				<RefreshCw className={cn("h-4 w-4", status === "checking" && "animate-spin")} />
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
				<div className="flex-1 relative min-h-0">
					{status === "checking" && (
						<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background">
							<RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
							<p className="text-xs text-muted-foreground">Connecting to preview...</p>
						</div>
					)}

					{status === "unavailable" && (
						<div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background">
							<div className="text-center space-y-3 px-4">
								<div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
									<MonitorIcon className="h-6 w-6 text-muted-foreground" />
								</div>
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
						</div>
					)}

					{status === "ready" && (
						<iframe
							ref={iframeRef}
							src={url}
							className="w-full h-full border-0"
							sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
							title="Preview"
						/>
					)}
				</div>
			</PanelShell>
		</div>
	);
}
