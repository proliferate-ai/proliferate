"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import type { VerificationFile } from "@proliferate/shared";
import { ArrowLeft, Grid, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AutoStartPanel } from "./auto-start-panel";
import { FileViewer } from "./file-viewer";
import { PreviewPanel } from "./preview-panel";
import { SessionInfoPanel } from "./session-info-panel";
import { SnapshotsPanel } from "./snapshots-panel";
import { VerificationGallery } from "./verification-gallery";

export interface SessionPanelProps {
	sessionStatus?: string;
	repoId?: string | null;
	prebuildId?: string | null;
	repoName?: string | null;
	branchName?: string | null;
	snapshotId?: string | null;
	startedAt?: string | null;
	concurrentUsers?: number;
	isModal?: boolean;
	onSecretsClick?: () => void;
	isMigrating?: boolean;
	canSnapshot?: boolean;
	isSnapshotting?: boolean;
	onSnapshot?: () => void;
}

interface RightPanelProps {
	isMobileFullScreen?: boolean;
	sessionProps?: SessionPanelProps;
}

export function RightPanel({ isMobileFullScreen, sessionProps }: RightPanelProps) {
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

	// Session info panel
	if (mode.type === "session-info" && sessionProps) {
		return <SessionInfoPanel {...sessionProps} onClose={handleClose} />;
	}

	// Snapshots panel
	if (mode.type === "snapshots" && sessionProps) {
		return (
			<SnapshotsPanel
				snapshotId={sessionProps.snapshotId}
				repoId={sessionProps.repoId}
				canSnapshot={sessionProps.canSnapshot}
				isSnapshotting={sessionProps.isSnapshotting}
				onSnapshot={sessionProps.onSnapshot}
				onClose={handleClose}
			/>
		);
	}

	// Auto-start panel
	if (mode.type === "service-commands") {
		return (
			<AutoStartPanel
				repoId={sessionProps?.repoId}
				prebuildId={sessionProps?.prebuildId}
				onClose={handleClose}
			/>
		);
	}

	// URL preview uses PreviewPanel which has its own header
	if (mode.type === "url") {
		return (
			<div className="flex flex-col h-full">
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
			<TooltipProvider delayDuration={150}>
				<div className="flex flex-col h-full">
					{/* Header */}
					<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
						<div className="flex items-center gap-2 min-w-0">
							{mode.type === "file" && galleryContext && (
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
							<span className="text-sm font-medium truncate">
								{mode.type === "file" ? mode.file.name : "Verification Evidence"}
							</span>
						</div>
						<div className="flex items-center gap-1 shrink-0">
							{mode.type === "file" && galleryContext && (
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
									<Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
										<X className="h-4 w-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Close panel</TooltipContent>
							</Tooltip>
						</div>
					</div>

					{/* Content */}
					<div className="flex-1 min-h-0">
						{mode.type === "file" && <FileViewer file={mode.file} />}
						{mode.type === "gallery" && <VerificationGallery files={mode.files} />}
					</div>
				</div>
			</TooltipProvider>
		);
	}

	// Should not reach here if panel is open
	return null;
}
