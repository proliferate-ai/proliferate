import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { ExternalLink, Loader2, Pause, Play } from "lucide-react";
import Link from "next/link";
import { WorkerOrb } from "./worker-card";

interface WorkerDetailHeaderProps {
	worker: {
		name: string;
		objective: string | null;
		status: string;
		managerSessionId: string;
	};
	onPause: () => void;
	onResume: () => void;
	onRunNow: () => void;
	isPausing: boolean;
	isResuming: boolean;
	isRunningNow: boolean;
}

export function WorkerDetailHeader({
	worker,
	onPause,
	onResume,
	onRunNow,
	isPausing,
	isResuming,
	isRunningNow,
}: WorkerDetailHeaderProps) {
	const status = worker.status as "active" | "paused" | "degraded" | "failed";

	return (
		<div className="flex items-center gap-4 mb-5">
			<WorkerOrb name={worker.name} size={44} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<h1 className="text-base font-semibold text-foreground truncate">{worker.name}</h1>
					<StatusDot
						status={status === "active" ? "active" : status === "paused" ? "paused" : "error"}
						size="sm"
					/>
				</div>
				{worker.objective && (
					<p className="text-xs text-muted-foreground mt-0.5 truncate">{worker.objective}</p>
				)}
			</div>
			<div className="flex items-center gap-1.5 shrink-0">
				{status === "active" && (
					<>
						<Button
							size="sm"
							variant="outline"
							className="h-7 gap-1.5 text-xs"
							onClick={onRunNow}
							disabled={isRunningNow}
						>
							{isRunningNow ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<Play className="h-3 w-3" />
							)}
							Run now
						</Button>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 gap-1.5 text-xs"
							onClick={onPause}
							disabled={isPausing}
						>
							<Pause className="h-3 w-3" />
							Pause
						</Button>
					</>
				)}
				{status === "paused" && (
					<Button
						size="sm"
						variant="outline"
						className="h-7 gap-1.5 text-xs"
						onClick={onResume}
						disabled={isResuming}
					>
						<Play className="h-3 w-3" />
						Resume
					</Button>
				)}
				<Link
					href={`/workspace/${worker.managerSessionId}`}
					className="inline-flex items-center gap-1 h-7 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					<ExternalLink className="h-3 w-3" />
				</Link>
			</div>
		</div>
	);
}
