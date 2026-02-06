"use client";

import { cn } from "@/lib/utils";

type StatusType = "active" | "paused" | "running" | "stopped" | "error";

interface StatusDotProps {
	status: StatusType;
	showWhenInactive?: boolean;
	size?: "sm" | "default";
	className?: string;
}

const statusColors: Record<StatusType, string> = {
	active: "bg-green-500",
	running: "bg-green-500",
	paused: "bg-yellow-500",
	stopped: "bg-muted-foreground/30",
	error: "bg-destructive",
};

export function StatusDot({
	status,
	showWhenInactive = true,
	size = "default",
	className,
}: StatusDotProps) {
	const isInactive = status === "stopped" || status === "paused";

	if (isInactive && !showWhenInactive) {
		return null;
	}

	const sizeClasses = {
		sm: "w-1.5 h-1.5",
		default: "w-2 h-2",
	};

	return (
		<span
			className={cn(
				"rounded-full flex-shrink-0",
				sizeClasses[size],
				statusColors[status],
				className,
			)}
		/>
	);
}
