"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/display/utils";
import { AlertTriangle, CheckCircle2, Loader2, Pause, XCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceBannerState =
	| "running"
	| "paused"
	| "waiting_for_approval"
	| "completed"
	| "failed";

interface WorkspaceStateBannerProps {
	state: WorkspaceBannerState;
	pauseReason?: string | null;
	outcome?: string | null;
	errorCode?: string | null;
	sandboxAvailable?: boolean;
	onResume?: () => void;
	onRerun?: () => void;
	onDelete?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkspaceStateBanner({
	state,
	pauseReason,
	outcome,
	errorCode,
	sandboxAvailable = true,
	onResume,
	onRerun,
	onDelete,
}: WorkspaceStateBannerProps) {
	// Running state: no banner needed
	if (state === "running") {
		return null;
	}

	return (
		<div
			className={cn(
				"flex items-center gap-3 px-4 py-2.5 border-b border-border/50 shrink-0",
				state === "paused" && "bg-muted/30",
				state === "waiting_for_approval" && "bg-muted/30",
				state === "completed" && "bg-muted/30",
				state === "failed" && "bg-muted/30",
			)}
		>
			{/* Icon */}
			{state === "paused" && <Pause className="h-4 w-4 text-muted-foreground shrink-0" />}
			{state === "waiting_for_approval" && (
				<Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
			)}
			{state === "completed" && <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" />}
			{state === "failed" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}

			{/* Message */}
			<div className="flex-1 min-w-0">
				{state === "paused" && (
					<>
						<span className="text-sm font-medium">Session paused</span>
						{pauseReason && (
							<span className="text-xs text-muted-foreground ml-2">{pauseReason}</span>
						)}
					</>
				)}
				{state === "waiting_for_approval" && (
					<span className="text-sm font-medium">Waiting for approval</span>
				)}
				{state === "completed" && (
					<>
						<span className="text-sm font-medium">Session completed</span>
						{outcome && outcome !== "completed" && (
							<span className="text-xs text-muted-foreground ml-2">{outcome}</span>
						)}
						{!sandboxAvailable && (
							<span className="text-xs text-muted-foreground ml-2">
								Sandbox expired. Showing metadata only.
							</span>
						)}
					</>
				)}
				{state === "failed" && (
					<>
						<span className="text-sm font-medium text-destructive">Session failed</span>
						{errorCode === "SANDBOX_LOST" && (
							<span className="text-xs text-muted-foreground ml-2">
								The sandbox was lost. The session cannot be recovered.
							</span>
						)}
						{errorCode && errorCode !== "SANDBOX_LOST" && (
							<span className="text-xs text-muted-foreground ml-2">{errorCode}</span>
						)}
					</>
				)}
			</div>

			{/* Actions */}
			<div className="flex items-center gap-1.5 shrink-0">
				{state === "paused" && onResume && (
					<Button variant="primary" size="sm" className="h-7 text-xs" onClick={onResume}>
						Resume
					</Button>
				)}
				{state === "failed" && (
					<>
						{onRerun && (
							<Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRerun}>
								Rerun
							</Button>
						)}
						{onDelete && (
							<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDelete}>
								Delete
							</Button>
						)}
					</>
				)}
			</div>
		</div>
	);
}

/**
 * Derive the workspace banner state from session data fields.
 */
export function deriveWorkspaceState(session: {
	status?: string | null;
	outcome?: string | null;
	pauseReason?: string | null;
	sandboxId?: string | null;
}): WorkspaceBannerState {
	if (session.status === "failed") return "failed";
	if (session.status === "paused") return "paused";
	if (session.status === "stopped" && session.outcome) return "completed";
	if (session.outcome === "completed" || session.outcome === "succeeded") return "completed";
	if (session.outcome === "failed") return "failed";
	return "running";
}
