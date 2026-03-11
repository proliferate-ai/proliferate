"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";

interface ToolCallGroupProps {
	children: ReactNode[];
	hasRunning: boolean;
}

export function ToolCallGroup({ children, hasRunning }: ToolCallGroupProps) {
	const [expanded, setExpanded] = useState(false);
	const count = children.length;

	if (count <= 1) {
		return <>{children}</>;
	}

	const isOpen = expanded || hasRunning;
	const completedCount = hasRunning ? count - 1 : count;

	return (
		<div className="my-1">
			<Button
				type="button"
				variant="ghost"
				onClick={() => setExpanded(!expanded)}
				className="h-auto gap-1.5 p-0 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
			>
				{isOpen ? (
					<ChevronDown className="h-3 w-3 shrink-0" />
				) : (
					<ChevronRight className="h-3 w-3 shrink-0" />
				)}
				{hasRunning ? (
					<Loader2 className="h-3 w-3 animate-spin shrink-0" />
				) : (
					<CheckCircle className="h-3 w-3 text-muted-foreground/50 shrink-0" />
				)}
				<span>{hasRunning ? `${completedCount} completed, 1 running` : `${count} tool calls`}</span>
			</Button>
			{isOpen && <div className="ml-1 border-l border-border/40 pl-2 mt-0.5">{children}</div>}
		</div>
	);
}
