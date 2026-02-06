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
import { useRef, useState } from "react";

interface PreviewPanelProps {
	url: string | null;
	className?: string;
	onClose?: () => void;
}

export function PreviewPanel({ url, className, onClose }: PreviewPanelProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isFullscreen, setIsFullscreen] = useState(false);

	const handleRefresh = () => {
		if (iframeRef.current) {
			setIsLoading(true);
			// biome-ignore lint/correctness/noSelfAssign: Intentional reload of iframe
			iframeRef.current.src = iframeRef.current.src;
		}
	};

	const handleLoad = () => {
		setIsLoading(false);
	};

	if (!url) {
		return (
			<div className={cn("flex flex-col h-full bg-muted/30", className)}>
				<div className="flex items-center justify-center h-full">
					<div className="text-center space-y-2 px-4">
						<div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center">
							<MonitorIcon className="h-5 w-5 text-muted-foreground" />
						</div>
						<div>
							<p className="text-sm font-medium text-muted-foreground">No Preview Available</p>
							<p className="text-xs text-muted-foreground/70 mt-1">
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
					<RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
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

			{/* Iframe */}
			<div className="flex-1 relative min-h-0">
				{isLoading && (
					<div className="absolute inset-0 flex items-center justify-center bg-muted/50">
						<RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				)}
				<iframe
					ref={iframeRef}
					src={url}
					className="w-full h-full border-0"
					onLoad={handleLoad}
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
					title="Preview"
				/>
			</div>
		</div>
	);
}
