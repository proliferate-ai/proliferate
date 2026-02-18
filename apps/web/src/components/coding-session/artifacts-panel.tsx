"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import type { VerificationFile } from "@proliferate/shared";
import { ArrowLeft, Grid } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionsContent } from "./actions-panel";
import { FileViewer } from "./file-viewer";
import { PanelShell } from "./panel-shell";
import { VerificationGallery } from "./verification-gallery";

interface ArtifactsPanelProps {
	sessionId: string;
	activityTick: number;
}

export function ArtifactsPanel({ sessionId, activityTick }: ArtifactsPanelProps) {
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
	const title = isFileView ? mode.file.name : isGalleryView ? "Verification Evidence" : "Workspace";

	const panelIcon =
		isFileView && galleryContext ? (
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
		) : undefined;

	const panelActions =
		isFileView && galleryContext ? (
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
		) : undefined;

	return (
		<PanelShell title={title} icon={panelIcon} actions={panelActions} noPadding>
			<div className="h-full min-h-0">
				{isFileView && <FileViewer file={mode.file} />}
				{isGalleryView && <VerificationGallery files={mode.files} />}
				{!isFileView && !isGalleryView && (
					<ActionsContent sessionId={sessionId} activityTick={activityTick} />
				)}
			</div>
		</PanelShell>
	);
}
