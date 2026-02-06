"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	prefetchVerificationUrls,
	useVerificationMediaUrl,
} from "@/hooks/use-verification-media-url";
import { formatBytes } from "@/lib/utils";
import type { VerificationFile } from "@proliferate/shared";
import { Download, ExternalLink, File, FileText, Image, Loader2, Video } from "lucide-react";
import { useEffect, useState } from "react";

// Image grid item with click to expand
function ImageGridItem({
	file,
	onClick,
}: {
	file: VerificationFile;
	onClick: () => void;
}) {
	const { url, isLoading, error } = useVerificationMediaUrl(file.key);

	if (isLoading) {
		return (
			<div className="relative aspect-video rounded-lg border border-border/50 bg-muted/30 flex items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (error || !url) {
		return (
			<div className="relative aspect-video rounded-lg border border-border/50 bg-muted/30 flex items-center justify-center">
				<span className="text-sm text-muted-foreground">Failed to load</span>
			</div>
		);
	}

	return (
		<Button
			variant="ghost"
			onClick={onClick}
			className="group relative aspect-video h-auto p-0 rounded-lg border border-border/50 bg-muted/30 overflow-hidden hover:border-primary/50 hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary"
			title={file.path}
		>
			<img src={url} alt={file.name} className="w-full h-full object-cover" />
			<div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
				<ExternalLink className="h-6 w-6 text-white" />
			</div>
			<div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
				<div className="text-sm font-medium text-white truncate">{file.path}</div>
				<div className="text-xs text-white/70">{formatBytes(file.size)}</div>
			</div>
		</Button>
	);
}

// Full image viewer
function ImageViewer({ file }: { file: VerificationFile }) {
	const { url, isLoading, error } = useVerificationMediaUrl(file.key);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (error || !url) {
		return (
			<div className="flex items-center justify-center h-64">
				<span className="text-muted-foreground">Failed to load image</span>
			</div>
		);
	}

	return (
		<div className="relative">
			<img src={url} alt={file.name} className="w-full h-auto max-h-[85vh] object-contain" />
			<div className="absolute top-2 right-2">
				<Button size="sm" variant="secondary" onClick={() => window.open(url, "_blank")}>
					<Download className="h-4 w-4 mr-1" />
					Download
				</Button>
			</div>
		</div>
	);
}

// Video player
function VideoPlayer({ file }: { file: VerificationFile }) {
	const { url, isLoading, error } = useVerificationMediaUrl(file.key);

	if (isLoading) {
		return (
			<div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
				<div className="aspect-video flex items-center justify-center">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</div>
				<div className="p-3 border-t border-border/30">
					<div className="font-medium">{file.name}</div>
					<div className="text-sm text-muted-foreground">{formatBytes(file.size)}</div>
				</div>
			</div>
		);
	}

	if (error || !url) {
		return (
			<div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
				<div className="aspect-video flex items-center justify-center">
					<span className="text-muted-foreground">Failed to load video</span>
				</div>
				<div className="p-3 border-t border-border/30">
					<div className="font-medium">{file.name}</div>
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
			<video src={url} controls className="w-full aspect-video" />
			<div className="p-3 border-t border-border/30">
				<div className="font-medium truncate" title={file.path}>
					{file.path}
				</div>
				<div className="text-sm text-muted-foreground">{formatBytes(file.size)}</div>
			</div>
		</div>
	);
}

// Text file viewer
function TextFileViewer({ file }: { file: VerificationFile }) {
	const { url, isLoading, error } = useVerificationMediaUrl(file.key);
	const [content, setContent] = useState<string | null>(null);
	const [contentLoading, setContentLoading] = useState(false);

	useEffect(() => {
		if (url && !content && !contentLoading) {
			setContentLoading(true);
			fetch(url)
				.then((res) => res.text())
				.then((text) => {
					setContent(text);
					setContentLoading(false);
				})
				.catch(() => {
					setContent("Failed to load content");
					setContentLoading(false);
				});
		}
	}, [url, content, contentLoading]);

	if (isLoading || contentLoading) {
		return (
			<div className="rounded-lg border border-border/50 bg-muted/30 p-4">
				<div className="flex items-center gap-2 mb-2">
					<FileText className="h-4 w-4" />
					<span className="font-medium">{file.name}</span>
					<Loader2 className="h-4 w-4 animate-spin ml-auto" />
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="rounded-lg border border-border/50 bg-muted/30 p-4">
				<div className="flex items-center gap-2 mb-2">
					<FileText className="h-4 w-4" />
					<span className="font-medium">{file.name}</span>
				</div>
				<div className="text-muted-foreground">Failed to load</div>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border/50 bg-muted/30">
			<div className="flex items-center gap-2 p-3 border-b border-border/30">
				<FileText className="h-4 w-4 shrink-0" />
				<span className="font-medium truncate" title={file.path}>
					{file.path}
				</span>
				<span className="text-sm text-muted-foreground ml-auto shrink-0">
					{formatBytes(file.size)}
				</span>
				{url && (
					<Button size="sm" variant="ghost" onClick={() => window.open(url, "_blank")}>
						<Download className="h-4 w-4" />
					</Button>
				)}
			</div>
			<ScrollArea className="h-[200px]">
				<pre className="p-3 text-xs font-mono whitespace-pre-wrap">{content}</pre>
			</ScrollArea>
		</div>
	);
}

// Generic file item
function GenericFileItem({ file }: { file: VerificationFile }) {
	const { url, isLoading } = useVerificationMediaUrl(file.key);

	return (
		<div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/30">
			<File className="h-5 w-5 text-muted-foreground shrink-0" />
			<div className="flex-1 min-w-0">
				<div className="font-medium truncate" title={file.path}>
					{file.path}
				</div>
				<div className="text-sm text-muted-foreground">
					{formatBytes(file.size)} • {file.contentType}
				</div>
			</div>
			{isLoading ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : url ? (
				<Button size="sm" variant="ghost" onClick={() => window.open(url, "_blank")}>
					<Download className="h-4 w-4" />
				</Button>
			) : null}
		</div>
	);
}

interface VerificationReportPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	files: VerificationFile[];
}

export function VerificationReportPanel({
	open,
	onOpenChange,
	files,
}: VerificationReportPanelProps) {
	const [selectedImage, setSelectedImage] = useState<number | null>(null);

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

	// Prefetch URLs when panel opens
	useEffect(() => {
		if (open && files.length > 0) {
			prefetchVerificationUrls(files.map((f) => f.key));
		}
	}, [open, files]);

	if (files.length === 0) return null;

	// Determine default tab
	const defaultTab =
		images.length > 0
			? "images"
			: videos.length > 0
				? "videos"
				: textFiles.length > 0
					? "text"
					: "other";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-4xl h-[85vh] p-0 gap-0 flex flex-col">
				<DialogHeader className="shrink-0 px-6 py-4 border-b">
					<DialogTitle className="flex items-center gap-2">
						Verification Evidence
						<span className="text-sm font-normal text-muted-foreground ml-auto">
							{files.length} file{files.length !== 1 ? "s" : ""}
						</span>
					</DialogTitle>
				</DialogHeader>

				<Tabs defaultValue={defaultTab} className="flex-1 flex flex-col min-h-0">
					<TabsList className="shrink-0 mx-6 mt-4 w-auto justify-start">
						{images.length > 0 && (
							<TabsTrigger value="images" className="gap-1.5">
								<Image className="h-4 w-4" />
								Images ({images.length})
							</TabsTrigger>
						)}
						{videos.length > 0 && (
							<TabsTrigger value="videos" className="gap-1.5">
								<Video className="h-4 w-4" />
								Videos ({videos.length})
							</TabsTrigger>
						)}
						{textFiles.length > 0 && (
							<TabsTrigger value="text" className="gap-1.5">
								<FileText className="h-4 w-4" />
								Logs ({textFiles.length})
							</TabsTrigger>
						)}
						{otherFiles.length > 0 && (
							<TabsTrigger value="other" className="gap-1.5">
								<File className="h-4 w-4" />
								Other ({otherFiles.length})
							</TabsTrigger>
						)}
					</TabsList>

					<div className="flex-1 min-h-0 p-6 overflow-auto">
						{/* Images Tab */}
						{images.length > 0 && (
							<TabsContent value="images" className="h-full m-0">
								<div className="grid grid-cols-2 md:grid-cols-3 gap-4">
									{images.map((file, i) => (
										<ImageGridItem key={file.key} file={file} onClick={() => setSelectedImage(i)} />
									))}
								</div>

								{/* Image Modal */}
								<Dialog open={selectedImage !== null} onOpenChange={() => setSelectedImage(null)}>
									<DialogContent className="max-w-[90vw] max-h-[90vh] p-0">
										<DialogTitle className="sr-only">
											{selectedImage !== null ? images[selectedImage]?.name : "Image"}
										</DialogTitle>
										{selectedImage !== null && <ImageViewer file={images[selectedImage]} />}
									</DialogContent>
								</Dialog>
							</TabsContent>
						)}

						{/* Videos Tab */}
						{videos.length > 0 && (
							<TabsContent value="videos" className="h-full m-0">
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									{videos.map((file) => (
										<VideoPlayer key={file.key} file={file} />
									))}
								</div>
							</TabsContent>
						)}

						{/* Text Tab */}
						{textFiles.length > 0 && (
							<TabsContent value="text" className="h-full m-0">
								<div className="space-y-4">
									{textFiles.map((file) => (
										<TextFileViewer key={file.key} file={file} />
									))}
								</div>
							</TabsContent>
						)}

						{/* Other Tab */}
						{otherFiles.length > 0 && (
							<TabsContent value="other" className="h-full m-0">
								<div className="space-y-2">
									{otherFiles.map((file) => (
										<GenericFileItem key={file.key} file={file} />
									))}
								</div>
							</TabsContent>
						)}
					</div>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
