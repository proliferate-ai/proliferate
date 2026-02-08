"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffectiveServiceCommands, useServiceCommands } from "@/hooks/use-repos";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { Box, Camera, Loader2, Play, X } from "lucide-react";

interface SnapshotsPanelProps {
	snapshotId?: string | null;
	repoId?: string | null;
	prebuildId?: string | null;
	canSnapshot?: boolean;
	isSnapshotting?: boolean;
	onSnapshot?: () => void;
	onClose: () => void;
}

export function SnapshotsPanel({
	snapshotId,
	repoId,
	prebuildId,
	canSnapshot,
	isSnapshotting,
	onSnapshot,
	onClose,
}: SnapshotsPanelProps) {
	const hasPrebuild = !!prebuildId;
	const { data: effective } = useEffectiveServiceCommands(prebuildId || "", hasPrebuild);
	const { data: repoCommands } = useServiceCommands(repoId || "", !hasPrebuild && !!repoId);
	const commands = hasPrebuild ? effective?.commands : repoCommands;
	const { openServiceCommands } = usePreviewPanelStore();
	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<TooltipProvider delayDuration={150}>
				<div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
					<span className="text-sm font-medium">Snapshots</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
								<X className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Close panel</TooltipContent>
					</Tooltip>
				</div>
			</TooltipProvider>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-4 space-y-6">
				{/* Save snapshot */}
				{onSnapshot && (
					<div className="space-y-3">
						<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Save
						</h3>
						<Button
							className="w-full justify-center gap-2"
							onClick={onSnapshot}
							disabled={!canSnapshot || isSnapshotting}
						>
							{isSnapshotting ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Camera className="h-4 w-4" />
							)}
							{isSnapshotting ? "Saving..." : "Save Snapshot"}
						</Button>
						<p className="text-xs text-muted-foreground">
							{canSnapshot
								? "Capture the current filesystem state."
								: "Session must be running to save a snapshot."}
						</p>
					</div>
				)}

				{/* Current snapshot */}
				{snapshotId && (
					<div className="space-y-3">
						<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Current
						</h3>
						<div
							className="flex items-center gap-2 text-sm text-muted-foreground"
							title={snapshotId}
						>
							<Box className="h-3.5 w-3.5 shrink-0" />
							<span className="font-mono text-xs truncate">{snapshotId}</span>
						</div>
					</div>
				)}

				{/* Auto-start hint */}
				{repoId && (
					<div className="space-y-3">
						<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Auto-start
						</h3>
						<button
							type="button"
							onClick={openServiceCommands}
							className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
						>
							<Play className="h-3.5 w-3.5 shrink-0" />
							<span>
								{commands && commands.length > 0
									? `${commands.length} command${commands.length === 1 ? "" : "s"} configured`
									: "Not configured"}
							</span>
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
