"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw } from "lucide-react";

interface WorkerFailureBannerProps {
	status: "degraded" | "failed";
	lastErrorCode: string | null;
	onRestart: () => void;
	onRecreate: () => void;
	isRestarting?: boolean;
}

export function WorkerFailureBanner({
	status,
	lastErrorCode,
	onRestart,
	onRecreate,
	isRestarting,
}: WorkerFailureBannerProps) {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="flex items-start gap-3">
				<AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium text-foreground">
						{status === "failed" ? "Manager session lost" : "Manager degraded"}
					</p>
					<p className="text-xs text-muted-foreground mt-0.5">
						{status === "failed"
							? "The manager sandbox was lost and the coworker cannot process new work. Recovery action is required."
							: "The manager is experiencing issues and may not process work reliably."}
						{lastErrorCode && <> Error: {lastErrorCode}</>}
					</p>
					<div className="flex items-center gap-2 mt-3">
						<Button
							variant="outline"
							size="sm"
							onClick={onRestart}
							disabled={isRestarting}
							className="h-7 gap-1.5 text-xs"
						>
							{isRestarting ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<RefreshCw className="h-3 w-3" />
							)}
							Restart manager
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={onRecreate}
							disabled={isRestarting}
							className="h-7 gap-1.5 text-xs"
						>
							<RotateCcw className="h-3 w-3" />
							Recreate session
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
