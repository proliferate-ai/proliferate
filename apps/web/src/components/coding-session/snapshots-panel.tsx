"use client";

import { Button } from "@/components/ui/button";
import { Box, Camera, Loader2, X } from "lucide-react";

interface SnapshotsPanelProps {
	snapshotId?: string | null;
	canSnapshot?: boolean;
	isSnapshotting?: boolean;
	onSnapshot?: () => void;
	onClose: () => void;
}

export function SnapshotsPanel({
	snapshotId,
	canSnapshot,
	isSnapshotting,
	onSnapshot,
	onClose,
}: SnapshotsPanelProps) {
	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
				<span className="text-sm font-medium">Snapshots</span>
				<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
					<X className="h-4 w-4" />
				</Button>
			</div>

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
			</div>
		</div>
	);
}
