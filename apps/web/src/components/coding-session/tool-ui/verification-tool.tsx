"use client";

import { Button } from "@/components/ui/button";
import {
	prefetchVerificationUrls,
	useVerificationFiles,
	useVerificationMediaUrl,
} from "@/hooks/use-verification-media-url";
import { formatBytes } from "@/lib/utils";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { makeAssistantToolUI } from "@assistant-ui/react";
import {
	VERIFICATION_FOLDER,
	type VerificationArgs,
	type VerificationFile,
	type VerificationResult,
} from "@proliferate/shared/verification";
import {
	ChevronDown,
	ChevronRight,
	File,
	FileCheck,
	FileText,
	Image,
	Loader2,
	Maximize2,
	Video,
} from "lucide-react";
import { useEffect, useState } from "react";

// Get icon for file based on content type
function getFileIcon(contentType: string) {
	if (contentType.startsWith("image/")) return Image;
	if (contentType.startsWith("video/")) return Video;
	if (contentType.startsWith("text/") || contentType === "application/json") return FileText;
	return File;
}

// Thumbnail component for images - opens in preview panel
function ImageThumbnail({
	file,
	onClick,
}: {
	file: VerificationFile;
	onClick: () => void;
}) {
	const { url, isLoading, error } = useVerificationMediaUrl(file.key);

	if (isLoading) {
		return (
			<div className="relative w-20 h-14 rounded border border-border/50 bg-muted/30 flex items-center justify-center">
				<Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (error || !url) {
		return (
			<div className="relative w-20 h-14 rounded border border-border/50 bg-muted/30 flex items-center justify-center">
				<span className="text-xs text-muted-foreground">Error</span>
			</div>
		);
	}

	return (
		<Button
			variant="ghost"
			onClick={onClick}
			className="group relative block w-20 h-14 p-0 rounded border border-border/50 bg-muted/30 overflow-hidden hover:border-primary/50 hover:ring-1 hover:ring-primary/30 hover:bg-muted/30"
		>
			<img src={url} alt={file.name} className="w-full h-full object-cover" />
			<div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
				<Maximize2 className="h-3 w-3 text-white" />
			</div>
		</Button>
	);
}

// File link component - opens in preview panel
function FileLink({
	file,
	onClick,
}: {
	file: VerificationFile;
	onClick: () => void;
}) {
	const { isLoading, error } = useVerificationMediaUrl(file.key);
	const Icon = getFileIcon(file.contentType);
	const displayName = file.path.includes("/") ? file.path : file.name;

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				<Loader2 className="h-3 w-3 animate-spin" />
				<span className="truncate">{displayName}</span>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
				<Icon className="h-3 w-3" />
				<span className="truncate">{displayName}</span>
				<span className="text-xs">(error)</span>
			</div>
		);
	}

	return (
		<Button
			variant="ghost"
			onClick={onClick}
			className="h-auto p-0 flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-transparent text-sm text-left"
			title={`Open ${file.path}`}
		>
			<Icon className="h-3 w-3 shrink-0" />
			<span className="truncate">{displayName}</span>
			<span className="text-xs text-muted-foreground/60 shrink-0">({formatBytes(file.size)})</span>
		</Button>
	);
}

export const VerificationToolUI = makeAssistantToolUI<
	VerificationArgs,
	string // Tool returns JSON string, we parse it
>({
	toolName: "verify",
	render: function VerificationUI({ args, result, status }) {
		const [isExpanded, setIsExpanded] = useState(true);
		const { openFile, openGallery } = usePreviewPanelStore();
		const isRunning = status.type === "running";
		const isComplete = status.type !== "running";

		// Parse the JSON result string to get the key
		// If parsing fails, result is an error message string
		const parsedResult: VerificationResult | null = (() => {
			if (!result) return null;
			try {
				return JSON.parse(result);
			} catch {
				return null;
			}
		})();

		// Check if result is an error message (non-JSON string)
		const errorMessage = result && !parsedResult && typeof result === "string" ? result : null;

		// Fetch files from S3 when we have a result
		const { files, isLoading: filesLoading } = useVerificationFiles(parsedResult?.key);

		// Prefetch URLs when files are loaded
		useEffect(() => {
			if (files.length > 0) {
				prefetchVerificationUrls(files.map((f) => f.key));
			}
		}, [files]);

		// Group files by type
		const images = files.filter((f) => f.contentType.startsWith("image/"));
		const videos = files.filter((f) => f.contentType.startsWith("video/"));
		const textFiles = files.filter(
			(f) => f.contentType.startsWith("text/") || f.contentType === "application/json",
		);
		const otherFiles = files.filter(
			(f) =>
				!f.contentType.startsWith("image/") &&
				!f.contentType.startsWith("video/") &&
				!f.contentType.startsWith("text/") &&
				f.contentType !== "application/json",
		);

		const folder = args.folder || VERIFICATION_FOLDER;
		const fileCount = files.length;

		return (
			<div className="ml-4 my-1">
				<Button
					variant="ghost"
					onClick={() => setIsExpanded(!isExpanded)}
					className="h-auto p-0 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-transparent group max-w-full"
				>
					{isRunning ? (
						<Loader2 className="h-3 w-3 animate-spin shrink-0" />
					) : isExpanded ? (
						<ChevronDown className="h-3 w-3 shrink-0" />
					) : (
						<ChevronRight className="h-3 w-3 shrink-0" />
					)}
					<FileCheck className="h-3 w-3 shrink-0" />
					<span className="shrink-0">Verify</span>
					<span className="text-muted-foreground/70 truncate min-w-0">
						{isComplete && fileCount > 0
							? `(${fileCount} file${fileCount !== 1 ? "s" : ""})`
							: `(${folder})`}
					</span>
				</Button>

				{isExpanded && isComplete && (
					<div className="ml-4 mt-2 space-y-3 text-sm">
						{filesLoading ? (
							<div className="flex items-center gap-2 text-muted-foreground">
								<Loader2 className="h-3 w-3 animate-spin" />
								<span>Loading files...</span>
							</div>
						) : errorMessage ? (
							<div className="text-destructive/80 text-xs font-mono whitespace-pre-wrap">
								{errorMessage}
							</div>
						) : files.length === 0 ? (
							<div className="text-muted-foreground/70">No files found</div>
						) : (
							<>
								{/* Images */}
								{images.length > 0 && (
									<div>
										<div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
											<Image className="h-3.5 w-3.5" />
											<span className="font-medium">Images ({images.length})</span>
										</div>
										<div className="flex flex-wrap gap-2">
											{images.map((file) => (
												<ImageThumbnail key={file.key} file={file} onClick={() => openFile(file)} />
											))}
										</div>
									</div>
								)}

								{/* Videos */}
								{videos.length > 0 && (
									<div>
										<div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
											<Video className="h-3.5 w-3.5" />
											<span className="font-medium">Videos ({videos.length})</span>
										</div>
										<div className="space-y-1">
											{videos.map((file) => (
												<FileLink key={file.key} file={file} onClick={() => openFile(file)} />
											))}
										</div>
									</div>
								)}

								{/* Text files */}
								{textFiles.length > 0 && (
									<div>
										<div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
											<FileText className="h-3.5 w-3.5" />
											<span className="font-medium">Logs & Text ({textFiles.length})</span>
										</div>
										<div className="space-y-1">
											{textFiles.map((file) => (
												<FileLink key={file.key} file={file} onClick={() => openFile(file)} />
											))}
										</div>
									</div>
								)}

								{/* Other files */}
								{otherFiles.length > 0 && (
									<div>
										<div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
											<File className="h-3.5 w-3.5" />
											<span className="font-medium">Other ({otherFiles.length})</span>
										</div>
										<div className="space-y-1">
											{otherFiles.map((file) => (
												<FileLink key={file.key} file={file} onClick={() => openFile(file)} />
											))}
										</div>
									</div>
								)}

								{/* View Full Report button */}
								{files.length > 0 && (
									<div className="pt-1 border-t border-border/30">
										<Button
											variant="ghost"
											onClick={() => openGallery(files)}
											className="h-auto p-0 flex items-center gap-1 text-xs text-primary hover:text-primary/80 hover:bg-transparent"
										>
											<Maximize2 className="h-3 w-3" />
											View Full Report
										</Button>
									</div>
								)}
							</>
						)}
					</div>
				)}
			</div>
		);
	},
});
