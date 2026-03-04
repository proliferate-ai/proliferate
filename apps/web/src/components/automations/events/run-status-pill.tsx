import { getRunStatusDisplay } from "@/lib/display/run-status";
import { cn } from "@/lib/display/utils";
import type { AutomationRunStatus } from "@proliferate/shared";

export function RunStatusPill({ status }: { status: AutomationRunStatus }) {
	const statusDisplay = getRunStatusDisplay(status);
	const StatusIcon = statusDisplay.icon;
	const shouldSpin = status === "running";

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-medium",
				statusDisplay.className,
			)}
		>
			<StatusIcon className={cn("h-3 w-3", shouldSpin && "animate-spin")} />
			{statusDisplay.label}
		</span>
	);
}
