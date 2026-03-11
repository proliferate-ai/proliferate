"use client";

import { CheckCircle, Loader2 } from "lucide-react";
import { getToolLabel } from "../config";

interface SystemDisplayProps {
	toolName: string;
	status?: { type: string };
}

export function SystemDisplay({ toolName, status }: SystemDisplayProps) {
	const isRunning = status?.type === "running";
	const label = getToolLabel(toolName);

	return (
		<div className="my-0.5 flex items-center gap-1.5 py-0.5">
			{isRunning ? (
				<Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
			) : (
				<CheckCircle className="h-3 w-3 text-success shrink-0" />
			)}
			<span className="text-xs font-medium text-muted-foreground">{label}</span>
		</div>
	);
}
