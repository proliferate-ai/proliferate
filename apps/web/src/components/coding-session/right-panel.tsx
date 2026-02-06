"use client";

import { Button } from "@/components/ui/button";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import type { VerificationFile } from "@proliferate/shared";
import { ArrowLeft, Grid, X } from "lucide-react";
import { useEffect, useState } from "react";
import { FileViewer } from "./file-viewer";
import { PreviewPanel } from "./preview-panel";
import { VerificationGallery } from "./verification-gallery";

interface RightPanelProps {
	isMobileFullScreen?: boolean;
}

export function RightPanel({ isMobileFullScreen }: RightPanelProps) {
	const { mode, close, openGallery, setMobileView } = usePreviewPanelStore();
	// Track the gallery files when viewing a single file (for back navigation)
	const [galleryContext, setGalleryContext] = useState<VerificationFile[] | null>(null);

	// When showing gallery, save it for back navigation
	useEffect(() => {
		if (mode.type === "gallery") {
			setGalleryContext(mode.files);
		}
	}, [mode]);

	const handleClose = () => {
		close();
		setMobileView("chat");
	};

	// URL preview uses PreviewPanel which has its own header
	if (mode.type === "url") {
		return (
			<div className="flex flex-col h-full md:border-l bg-background">
				<PreviewPanel
					url={mode.url}
					className="h-full"
					onClose={isMobileFullScreen ? handleClose : undefined}
				/>
			</div>
		);
	}

	// File viewer or gallery
	if (mode.type === "file" || mode.type === "gallery") {
		return (
			<div className="flex flex-col h-full md:border-l bg-background">
				{/* Header */}
				<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
					<div className="flex items-center gap-2 min-w-0">
						{mode.type === "file" && galleryContext && (
							<Button
								variant="ghost"
								size="icon"
								className="h-7 w-7 shrink-0"
								onClick={() => openGallery(galleryContext)}
								title="Back to gallery"
							>
								<ArrowLeft className="h-4 w-4" />
							</Button>
						)}
						<span className="text-sm font-medium truncate">
							{mode.type === "file" ? mode.file.name : "Verification Evidence"}
						</span>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						{mode.type === "file" && galleryContext && (
							<Button
								variant="ghost"
								size="icon"
								className="h-7 w-7"
								onClick={() => openGallery(galleryContext)}
								title="View all files"
							>
								<Grid className="h-4 w-4" />
							</Button>
						)}
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7"
							onClick={handleClose}
							title="Close panel"
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 min-h-0">
					{mode.type === "file" && <FileViewer file={mode.file} />}
					{mode.type === "gallery" && <VerificationGallery files={mode.files} />}
				</div>
			</div>
		);
	}

	// Should not reach here if panel is open
	return null;
}
