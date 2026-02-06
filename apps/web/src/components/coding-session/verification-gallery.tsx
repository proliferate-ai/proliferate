"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	fetchVerificationTextContent,
	prefetchVerificationUrls,
	useVerificationMediaUrl,
} from "@/hooks/use-verification-media-url";
import { formatBytes } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import type { VerificationFile } from "@proliferate/shared";
import { File, FileText, Image, Loader2, Play, Video } from "lucide-react";
import { useEffect, useState } from "react";

interface VerificationGalleryProps {
	files: VerificationFile[];
}

export function VerificationGallery({ files }: VerificationGalleryProps) {
	const { openFile } = usePreviewPanelStore();

	// Prefetch all URLs
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

	if (files.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground">
				<p>No verification files</p>
			</div>
		);
	}

	return (
		<ScrollArea className="h-full">
			<div className="p-4 space-y-6">
				{/* Summary */}
				<div className="flex items-center gap-4 text-sm text-muted-foreground">
					{images.length > 0 && (
						<span className="flex items-center gap-1">
							<Image className="h-4 w-4" />
							{images.length} image{images.length !== 1 ? "s" : ""}
						</span>
					)}
					{videos.length > 0 && (
						<span className="flex items-center gap-1">
							<Video className="h-4 w-4" />
							{videos.length} video{videos.length !== 1 ? "s" : ""}
						</span>
					)}
					{textFiles.length > 0 && (
						<span className="flex items-center gap-1">
							<FileText className="h-4 w-4" />
							{textFiles.length} log{textFiles.length !== 1 ? "s" : ""}
						</span>
					)}
					{otherFiles.length > 0 && (
						<span className="flex items-center gap-1">
							<File className="h-4 w-4" />
							{otherFiles.length} other
						</span>
					)}
				</div>

				{/* Images Grid */}
				{images.length > 0 && (
					<section>
						<h3 className="text-sm font-medium mb-3 flex items-center gap-2">
							<Image className="h-4 w-4" />
							Screenshots & Images
						</h3>
						<div className="grid grid-cols-2 gap-3">
							{images.map((file) => (
								<ImageTile key={file.key} file={file} onClick={() => openFile(file)} />
							))}
						</div>
					</section>
				)}

				{/* Videos */}
				{videos.length > 0 && (
					<section>
						<h3 className="text-sm font-medium mb-3 flex items-center gap-2">
							<Video className="h-4 w-4" />
							Videos
						</h3>
						<div className="grid grid-cols-2 gap-3">
							{videos.map((file) => (
								<VideoTile key={file.key} file={file} onClick={() => openFile(file)} />
							))}
						</div>
					</section>
				)}

				{/* Text/Logs */}
				{textFiles.length > 0 && (
					<section>
						<h3 className="text-sm font-medium mb-3 flex items-center gap-2">
							<FileText className="h-4 w-4" />
							Logs & Text Files
						</h3>
						<div className="space-y-2">
							{textFiles.map((file) => (
								<TextFileTile key={file.key} file={file} onClick={() => openFile(file)} />
							))}
						</div>
					</section>
				)}

				{/* Other */}
				{otherFiles.length > 0 && (
					<section>
						<h3 className="text-sm font-medium mb-3 flex items-center gap-2">
							<File className="h-4 w-4" />
							Other Files
						</h3>
						<div className="space-y-2">
							{otherFiles.map((file) => (
								<GenericFileTile key={file.key} file={file} onClick={() => openFile(file)} />
							))}
						</div>
					</section>
				)}
			</div>
		</ScrollArea>
	);
}

// Image tile with thumbnail
function ImageTile({
	file,
	onClick,
}: {
	file: VerificationFile;
	onClick: () => void;
}) {
	const { url, isLoading, error } = useVerificationMediaUrl(file.key);

	return (
		<Button
			variant="ghost"
			onClick={onClick}
			className={cn(
				"group relative aspect-video h-auto p-0 rounded-lg overflow-hidden",
				"border border-border/50 bg-muted/30",
				"hover:border-primary/50 hover:ring-2 hover:ring-primary/20 hover:bg-muted/30",
				"focus:outline-none focus:ring-2 focus:ring-primary",
			)}
		>
			{isLoading ? (
				<div className="absolute inset-0 flex items-center justify-center">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : error || !url ? (
				<div className="absolute inset-0 flex items-center justify-center">
					<Image className="h-8 w-8 text-muted-foreground/50" />
				</div>
			) : (
				<img
					src={url}
					alt={file.name}
					className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
				/>
			)}

			{/* Overlay with file info */}
			<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-2 pt-6">
				<p className="text-xs font-medium text-white truncate">{file.name}</p>
				<p className="text-xs text-white/70">{formatBytes(file.size)}</p>
			</div>

			{/* Hover indicator */}
			<div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
		</Button>
	);
}

// Video tile with thumbnail
function VideoTile({
	file,
	onClick,
}: {
	file: VerificationFile;
	onClick: () => void;
}) {
	const { url, isLoading, error } = useVerificationMediaUrl(file.key);

	return (
		<Button
			variant="ghost"
			onClick={onClick}
			className={cn(
				"group relative aspect-video h-auto p-0 rounded-lg overflow-hidden",
				"border border-border/50 bg-muted/30",
				"hover:border-primary/50 hover:ring-2 hover:ring-primary/20 hover:bg-muted/30",
				"focus:outline-none focus:ring-2 focus:ring-primary",
			)}
		>
			{isLoading ? (
				<div className="absolute inset-0 flex items-center justify-center">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : error || !url ? (
				<div className="absolute inset-0 flex items-center justify-center bg-muted/50">
					<Video className="h-8 w-8 text-muted-foreground/50" />
				</div>
			) : (
				<>
					<video src={url} className="w-full h-full object-cover" preload="metadata" muted />
					{/* Play button overlay */}
					<div className="absolute inset-0 flex items-center justify-center">
						<div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center group-hover:bg-primary/80 transition-colors">
							<Play className="h-5 w-5 text-white ml-0.5" fill="currentColor" />
						</div>
					</div>
				</>
			)}

			{/* Overlay with file info */}
			<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-2 pt-6">
				<p className="text-xs font-medium text-white truncate">{file.name}</p>
				<p className="text-xs text-white/70">{formatBytes(file.size)}</p>
			</div>
		</Button>
	);
}

// Text file tile with preview - uses API to avoid CORS
function TextFileTile({
	file,
	onClick,
}: {
	file: VerificationFile;
	onClick: () => void;
}) {
	const [preview, setPreview] = useState<string | null>(null);

	useEffect(() => {
		fetchVerificationTextContent(file.key)
			.then((text) => setPreview(text.slice(0, 200)))
			.catch(() => setPreview(null));
	}, [file.key]);

	return (
		<Button
			variant="ghost"
			onClick={onClick}
			className={cn(
				"w-full h-auto text-left rounded-lg p-3",
				"border border-border/50 bg-muted/20",
				"hover:border-primary/50 hover:bg-muted/40",
				"focus:outline-none focus:ring-2 focus:ring-primary",
			)}
		>
			<div className="flex items-start gap-3">
				<div className="shrink-0 w-8 h-8 rounded bg-muted flex items-center justify-center">
					<FileText className="h-4 w-4 text-muted-foreground" />
				</div>
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium truncate">{file.name}</p>
					<p className="text-xs text-muted-foreground mb-2">{formatBytes(file.size)}</p>
					{preview && (
						<pre className="text-xs text-muted-foreground/70 font-mono line-clamp-2 whitespace-pre-wrap">
							{preview}
						</pre>
					)}
				</div>
			</div>
		</Button>
	);
}

// Generic file tile
function GenericFileTile({
	file,
	onClick,
}: {
	file: VerificationFile;
	onClick: () => void;
}) {
	return (
		<Button
			variant="ghost"
			onClick={onClick}
			className={cn(
				"w-full h-auto text-left rounded-lg p-3",
				"border border-border/50 bg-muted/20",
				"hover:border-primary/50 hover:bg-muted/40",
				"focus:outline-none focus:ring-2 focus:ring-primary",
			)}
		>
			<div className="flex items-center gap-3">
				<div className="shrink-0 w-8 h-8 rounded bg-muted flex items-center justify-center">
					<File className="h-4 w-4 text-muted-foreground" />
				</div>
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium truncate">{file.name}</p>
					<p className="text-xs text-muted-foreground">
						{formatBytes(file.size)} • {file.contentType}
					</p>
				</div>
			</div>
		</Button>
	);
}
