"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	fetchVerificationTextContent,
	useVerificationMediaUrl,
} from "@/hooks/use-verification-media-url";
import { formatBytes } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { VerificationFile } from "@proliferate/shared";
import {
	ChevronLeft,
	ChevronRight,
	Download,
	ExternalLink,
	Loader2,
	RotateCw,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Dynamically import react-pdf to avoid SSR issues (DOMMatrix not defined)
const Document = dynamic(() => import("react-pdf").then((mod) => mod.Document), { ssr: false });
const Page = dynamic(() => import("react-pdf").then((mod) => mod.Page), { ssr: false });

// Set up PDF.js worker (only runs on client)
if (typeof window !== "undefined") {
	import("react-pdf").then((pdfModule) => {
		pdfModule.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfModule.pdfjs.version}/build/pdf.worker.min.mjs`;
	});
}

interface FileViewerProps {
	file: VerificationFile;
}

export function FileViewer({ file }: FileViewerProps) {
	const { url, isLoading, error } = useVerificationMediaUrl(file.key);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (error || !url) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center space-y-2">
					<p className="text-muted-foreground">Failed to load file</p>
					<p className="text-sm text-muted-foreground/70">{error}</p>
				</div>
			</div>
		);
	}

	// Render based on content type and file extension
	if (file.contentType.startsWith("image/")) {
		return <ImageViewer url={url} file={file} />;
	}

	if (file.contentType.startsWith("video/")) {
		return <VideoViewer url={url} file={file} />;
	}

	if (file.contentType === "application/pdf" || file.name.endsWith(".pdf")) {
		return <PdfViewer url={url} file={file} />;
	}

	// Markdown files get special rendering
	if (
		file.contentType === "text/markdown" ||
		file.name.endsWith(".md") ||
		file.name.endsWith(".mdx")
	) {
		return <MarkdownViewer url={url} file={file} />;
	}

	if (file.contentType.startsWith("text/") || file.contentType === "application/json") {
		return <TextViewer url={url} file={file} />;
	}

	// Generic file - show download option
	return <GenericViewer url={url} file={file} />;
}

// Image viewer with zoom controls
function ImageViewer({ url, file }: { url: string; file: VerificationFile }) {
	const [zoom, setZoom] = useState(1);
	const [rotation, setRotation] = useState(0);

	return (
		<div className="flex flex-col h-full">
			{/* Toolbar */}
			<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20 shrink-0">
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
						title="Zoom out"
					>
						<ZoomOut className="h-4 w-4" />
					</Button>
					<span className="text-xs text-muted-foreground w-12 text-center">
						{Math.round(zoom * 100)}%
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
						title="Zoom in"
					>
						<ZoomIn className="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 ml-2"
						onClick={() => setRotation((r) => (r + 90) % 360)}
						title="Rotate"
					>
						<RotateCw className="h-4 w-4" />
					</Button>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
					<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
						<a href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab">
							<ExternalLink className="h-4 w-4" />
						</a>
					</Button>
					<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
						<a href={url} download={file.name} title="Download">
							<Download className="h-4 w-4" />
						</a>
					</Button>
				</div>
			</div>

			{/* Image */}
			<div className="flex-1 overflow-auto bg-[#1a1a1a] flex items-center justify-center p-4">
				<img
					src={url}
					alt={file.name}
					className="max-w-none transition-transform duration-200"
					style={{
						transform: `scale(${zoom}) rotate(${rotation}deg)`,
					}}
					draggable={false}
				/>
			</div>
		</div>
	);
}

// Video viewer
function VideoViewer({ url, file }: { url: string; file: VerificationFile }) {
	return (
		<div className="flex flex-col h-full">
			{/* Toolbar */}
			<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20 shrink-0">
				<span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
						<a href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab">
							<ExternalLink className="h-4 w-4" />
						</a>
					</Button>
					<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
						<a href={url} download={file.name} title="Download">
							<Download className="h-4 w-4" />
						</a>
					</Button>
				</div>
			</div>

			{/* Video */}
			<div className="flex-1 flex items-center justify-center bg-black p-4">
				<video src={url} controls className="max-w-full max-h-full" autoPlay={false} />
			</div>
		</div>
	);
}

// PDF viewer - uses API proxy to avoid CORS issues with R2
function PdfViewer({ url, file }: { url: string; file: VerificationFile }) {
	const [numPages, setNumPages] = useState<number | null>(null);
	const [pageNumber, setPageNumber] = useState(1);
	const [scale, setScale] = useState(1);

	// Use API proxy URL to avoid CORS issues
	const proxyUrl = `/api/verification-media?key=${encodeURIComponent(file.key)}&stream=true`;

	function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
		setNumPages(numPages);
	}

	return (
		<div className="flex flex-col h-full">
			{/* Toolbar */}
			<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20 shrink-0">
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
						disabled={pageNumber <= 1}
						title="Previous page"
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<span className="text-xs text-muted-foreground min-w-[60px] text-center">
						{numPages ? `${pageNumber} / ${numPages}` : "..."}
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						onClick={() => setPageNumber((p) => Math.min(numPages || p, p + 1))}
						disabled={!numPages || pageNumber >= numPages}
						title="Next page"
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
					<div className="h-4 w-px bg-border mx-1" />
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
						title="Zoom out"
					>
						<ZoomOut className="h-4 w-4" />
					</Button>
					<span className="text-xs text-muted-foreground w-12 text-center">
						{Math.round(scale * 100)}%
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						onClick={() => setScale((s) => Math.min(3, s + 0.25))}
						title="Zoom in"
					>
						<ZoomIn className="h-4 w-4" />
					</Button>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
					<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
						<a href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab">
							<ExternalLink className="h-4 w-4" />
						</a>
					</Button>
					<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
						<a href={url} download={file.name} title="Download">
							<Download className="h-4 w-4" />
						</a>
					</Button>
				</div>
			</div>

			{/* PDF Content */}
			<div className="flex-1 overflow-auto bg-muted/30 flex justify-center p-4">
				<Document
					file={proxyUrl}
					onLoadSuccess={onDocumentLoadSuccess}
					loading={
						<div className="flex items-center justify-center h-32">
							<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					}
					error={
						<div className="flex flex-col items-center justify-center h-32 text-center">
							<p className="text-muted-foreground mb-2">Failed to load PDF</p>
							<a
								href={url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-xs text-primary hover:underline"
							>
								Open in new tab
							</a>
						</div>
					}
				>
					<Page
						pageNumber={pageNumber}
						scale={scale}
						className="shadow-lg"
						renderTextLayer={true}
						renderAnnotationLayer={true}
					/>
				</Document>
			</div>
		</div>
	);
}

// Markdown viewer with proper rendering
function MarkdownViewer({ url, file }: { url: string; file: VerificationFile }) {
	const [content, setContent] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [fetchError, setFetchError] = useState<string | null>(null);

	useEffect(() => {
		setLoading(true);
		setFetchError(null);
		fetchVerificationTextContent(file.key)
			.then((text) => {
				setContent(text);
				setLoading(false);
			})
			.catch((err) => {
				console.error("Failed to fetch markdown:", err);
				setFetchError(err.message || "Failed to load content");
				setLoading(false);
			});
	}, [file.key]);

	return (
		<div className="flex flex-col h-full">
			{/* Toolbar */}
			<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20 shrink-0">
				<span className="text-xs text-muted-foreground">{formatBytes(file.size)} • Markdown</span>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
						<a href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab">
							<ExternalLink className="h-4 w-4" />
						</a>
					</Button>
					<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
						<a href={url} download={file.name} title="Download">
							<Download className="h-4 w-4" />
						</a>
					</Button>
				</div>
			</div>

			{/* Markdown Content */}
			<ScrollArea className="flex-1">
				{loading ? (
					<div className="flex items-center justify-center h-32">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : fetchError ? (
					<div className="flex flex-col items-center justify-center h-32 text-center p-4">
						<p className="text-muted-foreground mb-2">Failed to load content</p>
						<p className="text-xs text-muted-foreground/70">{fetchError}</p>
					</div>
				) : (
					<div className="p-6 prose prose-sm prose-invert max-w-none">
						<ReactMarkdown>{content || ""}</ReactMarkdown>
					</div>
				)}
			</ScrollArea>
		</div>
	);
}

// Text/code viewer - uses API proxy to avoid CORS issues
function TextViewer({ url, file }: { url: string; file: VerificationFile }) {
	const [content, setContent] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [fetchError, setFetchError] = useState<string | null>(null);

	useEffect(() => {
		setLoading(true);
		setFetchError(null);
		fetchVerificationTextContent(file.key)
			.then((text) => {
				setContent(text);
				setLoading(false);
			})
			.catch((err) => {
				console.error("Failed to fetch text content:", err);
				setFetchError(err.message || "Failed to load content");
				setLoading(false);
			});
	}, [file.key]);

	// Determine if this is likely code
	const isCode =
		/\.(js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|css|scss|json|yaml|yml|sh|bash|log)$/i.test(
			file.name,
		);

	return (
		<div className="flex flex-col h-full">
			{/* Toolbar */}
			<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20 shrink-0">
				<span className="text-xs text-muted-foreground">
					{formatBytes(file.size)} • {file.contentType}
				</span>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
						<a href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab">
							<ExternalLink className="h-4 w-4" />
						</a>
					</Button>
					<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
						<a href={url} download={file.name} title="Download">
							<Download className="h-4 w-4" />
						</a>
					</Button>
				</div>
			</div>

			{/* Content */}
			<ScrollArea className="flex-1">
				{loading ? (
					<div className="flex items-center justify-center h-32">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : fetchError ? (
					<div className="flex flex-col items-center justify-center h-32 text-center p-4">
						<p className="text-muted-foreground mb-2">Failed to load content</p>
						<p className="text-xs text-muted-foreground/70">{fetchError}</p>
						<a
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-3 text-xs text-primary hover:underline"
						>
							Open in new tab instead
						</a>
					</div>
				) : (
					<pre
						className={cn(
							"p-4 text-sm font-mono whitespace-pre-wrap break-all",
							isCode && "bg-muted/30",
						)}
					>
						{content}
					</pre>
				)}
			</ScrollArea>
		</div>
	);
}

// Generic file viewer
function GenericViewer({ url, file }: { url: string; file: VerificationFile }) {
	return (
		<div className="flex flex-col items-center justify-center h-full p-8 text-center">
			<div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
				<Download className="h-8 w-8 text-muted-foreground" />
			</div>
			<h3 className="font-medium mb-1">{file.name}</h3>
			<p className="text-sm text-muted-foreground mb-4">
				{formatBytes(file.size)} • {file.contentType}
			</p>
			<div className="flex gap-2">
				<Button variant="outline" asChild>
					<a href={url} target="_blank" rel="noopener noreferrer">
						<ExternalLink className="h-4 w-4 mr-2" />
						Open
					</a>
				</Button>
				<Button asChild>
					<a href={url} download={file.name}>
						<Download className="h-4 w-4 mr-2" />
						Download
					</a>
				</Button>
			</div>
		</div>
	);
}
