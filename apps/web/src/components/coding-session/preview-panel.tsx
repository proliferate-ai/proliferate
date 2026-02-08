"use client";

import { Button } from "@/components/ui/button";
import {
	ArrowLeft,
	ExternalLink,
	Maximize2,
	Minimize2,
	MonitorIcon,
	RefreshCw,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";

interface PreviewPanelProps {
	url: string | null;
	className?: string;
	onClose?: () => void;
}

export function PreviewPanel({ url, className, onClose }: PreviewPanelProps) {
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

	// Poll the URL to check if the server is actually serving
	useEffect(() => {
		if (!url) return;

		let cancelled = false;
		let attempts = 0;
		const maxAttempts = 5;
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

			setTimeout(() => {
				if (!cancelled) poll();
			}, 3000);
		};

		poll();
		return () => {
			cancelled = true;
		};
	}, [url, checkUrl, refreshKey]);

	const handleRefresh = useCallback(() => {
		setRefreshKey((k) => k + 1);
	}, []);

	if (!url) {
		return (
			<div className={cn("flex flex-col h-full", className)}>
				<div className="flex items-center justify-center h-full">
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
			</div>
		);
	}

	return (
		<div
			className={cn(
				"flex flex-col h-full",
				className,
				isFullscreen && "fixed inset-0 z-50 bg-background",
			)}
		>
			{/* Toolbar */}
			<div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
				{onClose && (
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 md:hidden"
						onClick={onClose}
						title="Back to chat"
					>
						<ArrowLeft className="h-4 w-4" />
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7"
					onClick={handleRefresh}
					title="Refresh"
				>
					<RefreshCw className={cn("h-4 w-4", status === "checking" && "animate-spin")} />
				</Button>

				<div className="flex-1 min-w-0">
					<span className="text-xs text-muted-foreground truncate block">{url}</span>
				</div>

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
		</div>
	);
}
