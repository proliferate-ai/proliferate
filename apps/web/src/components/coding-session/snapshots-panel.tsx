"use client";

import { Button } from "@/components/ui/button";
import { useEffectiveServiceCommands, useServiceCommands } from "@/hooks/use-repos";
import { Box, Camera, Loader2, Play } from "lucide-react";

export interface SnapshotsContentProps {
	snapshotId?: string | null;
	repoId?: string | null;
	configurationId?: string | null;
	canSnapshot?: boolean;
	isSnapshotting?: boolean;
	onSnapshot?: () => void;
	onNavigateAutoStart?: () => void;
}

export function SnapshotsContent({
	snapshotId,
	repoId,
	configurationId,
	canSnapshot,
	isSnapshotting,
	onSnapshot,
	onNavigateAutoStart,
}: SnapshotsContentProps) {
	const hasConfiguration = !!configurationId;
	const { data: effective, isLoading: effectiveLoading } = useEffectiveServiceCommands(
		configurationId || "",
		hasConfiguration,
	);
	const { data: repoCommands, isLoading: repoLoading } = useServiceCommands(
		repoId || "",
		!hasConfiguration && !!repoId,
	);
	const commands = hasConfiguration ? effective?.commands : repoCommands;
	const commandsLoading = hasConfiguration ? effectiveLoading : repoLoading;

	return (
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
					<div className="flex items-center gap-2 text-sm text-muted-foreground" title={snapshotId}>
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
						onClick={onNavigateAutoStart}
						className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
					>
						<Play className="h-3.5 w-3.5 shrink-0" />
						<span>
							{commandsLoading
								? "Loading..."
								: commands && commands.length > 0
									? `${commands.length} command${commands.length === 1 ? "" : "s"} configured`
									: "Not configured"}
						</span>
					</button>
				</div>
			)}
		</div>
	);
}
