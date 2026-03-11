"use client";

import { CheckCircle, Loader2 } from "lucide-react";
import { getToolLabel } from "../config";

interface MetaDisplayProps {
	toolName: string;
	args: Record<string, unknown>;
	status?: { type: string };
}

export function MetaDisplay({ toolName, args, status }: MetaDisplayProps) {
	const isRunning = status?.type === "running";
	const label = getToolLabel(toolName);
	const title = (args.title as string) ?? (args.name as string) ?? null;

	return (
		<div className="my-0.5 flex items-center gap-1.5 py-0.5">
			{isRunning ? (
				<Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
			) : (
				<CheckCircle className="h-3 w-3 text-muted-foreground/50 shrink-0" />
			)}
			<span className="text-xs text-muted-foreground">
				{label}
				{title && <span className="text-muted-foreground/60"> — {title}</span>}
			</span>
		</div>
	);
}
