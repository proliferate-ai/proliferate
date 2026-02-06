"use client";

import { Button } from "@/components/ui/button";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import type { TaskToolMetadata } from "../message-converter";

type TaskArgs = {
	description?: string;
	prompt?: string;
	subagent_type?: string;
	__metadata?: TaskToolMetadata;
};

function capitalizeFirst(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

export const TaskToolUI = makeAssistantToolUI<TaskArgs, string>({
	toolName: "task",
	render: function TaskUI({ args, result, status }) {
		const [isExpanded, setIsExpanded] = useState(false);
		const isRunning = status.type === "running";

		const description = args.description || "Task";
		const agentType = args.subagent_type || "agent";
		const metadata = args.__metadata;
		const summary = metadata?.summary || [];

		// Find current running tool
		const currentTool = summary.find((item) => item.state.status === "pending");

		return (
			<div className="ml-4 my-0.5">
				<Button
					variant="ghost"
					onClick={() => result && setIsExpanded(!isExpanded)}
					disabled={!result}
					className="h-auto p-0 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-transparent disabled:cursor-default group max-w-full"
				>
					{isRunning ? (
						<Loader2 className="h-3 w-3 animate-spin shrink-0" />
					) : isExpanded ? (
						<ChevronDown className="h-3 w-3 shrink-0" />
					) : (
						<ChevronRight className="h-3 w-3 shrink-0" />
					)}
					<span className="shrink-0">{capitalizeFirst(agentType)}</span>
					<span className="text-muted-foreground/70 truncate min-w-0">({description})</span>
					{isRunning && currentTool && (
						<span className="text-xs text-muted-foreground/50 shrink-0">
							· {currentTool.tool}...
						</span>
					)}
					{!isRunning && summary.length > 0 && (
						<span className="text-xs text-muted-foreground/50 shrink-0">
							{summary.length} tool{summary.length !== 1 ? "s" : ""}
						</span>
					)}
				</Button>

				{/* Expanded: tool summary list */}
				{isExpanded && result && summary.length > 0 && (
					<div className="ml-4 mt-1 space-y-0.5">
						{summary.map((item, index) => (
							<div
								key={item.id || index}
								className="flex items-center gap-1.5 text-xs text-muted-foreground/70"
							>
								{item.state.status === "completed" ? (
									<ChevronRight className="h-2.5 w-2.5 text-muted-foreground/50" />
								) : item.state.status === "error" ? (
									<span className="text-red-500/70 text-[10px]">✗</span>
								) : (
									<span className="text-muted-foreground/50 text-[10px]">○</span>
								)}
								<span className="capitalize">{item.tool}</span>
								{item.state.title && (
									<span className="text-muted-foreground/50 truncate">{item.state.title}</span>
								)}
							</div>
						))}
					</div>
				)}

				{/* Result text if no summary */}
				{isExpanded && result && summary.length === 0 && (
					<pre className="ml-4 mt-1 max-h-40 overflow-auto rounded border border-border/40 bg-muted/30 p-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
						{result.slice(0, 2000)}
						{result.length > 2000 && "\n..."}
					</pre>
				)}
			</div>
		);
	},
});
