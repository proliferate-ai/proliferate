"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import type { VerificationFile } from "@proliferate/shared";
import { ArrowLeft, Grid, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionsContent } from "./actions-panel";
import { FileViewer } from "./file-viewer";
import { VerificationGallery } from "./verification-gallery";

interface ArtifactsPanelProps {
	sessionId: string;
	activityTick: number;
	onClose: () => void;
}

export function ArtifactsPanel({ sessionId, activityTick, onClose }: ArtifactsPanelProps) {
	const { mode, openGallery } = usePreviewPanelStore();
	const [galleryContext, setGalleryContext] = useState<VerificationFile[] | null>(null);

	// Track gallery context for back navigation
	useEffect(() => {
		if (mode.type === "gallery") {
			setGalleryContext(mode.files);
		}
	}, [mode]);

	const isFileView = mode.type === "file";
	const isGalleryView = mode.type === "gallery";

	// Determine header title
	const title = isFileView ? mode.file.name : isGalleryView ? "Verification Evidence" : "Artifacts";

	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex flex-col h-full">
				{/* Header */}
				<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
					<div className="flex items-center gap-2 min-w-0">
						{isFileView && galleryContext && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 shrink-0"
										onClick={() => openGallery(galleryContext)}
									>
										<ArrowLeft className="h-4 w-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Back to gallery</TooltipContent>
							</Tooltip>
						)}
						<span className="text-sm font-medium truncate">{title}</span>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						{isFileView && galleryContext && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() => openGallery(galleryContext)}
									>
										<Grid className="h-4 w-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>View all files</TooltipContent>
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
				<div className="flex-1 min-h-0">
					{isFileView && <FileViewer file={mode.file} />}
					{isGalleryView && <VerificationGallery files={mode.files} />}
					{!isFileView && !isGalleryView && (
						<ActionsContent sessionId={sessionId} activityTick={activityTick} />
					)}
				</div>
			</div>
		</TooltipProvider>
	);
}
