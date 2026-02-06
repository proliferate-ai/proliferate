"use client";

import { Button } from "@/components/ui/button";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";

type GlobArgs = {
	pattern?: string;
	path?: string;
};

export const GlobToolUI = makeAssistantToolUI<GlobArgs, string>({
	toolName: "glob",
	render: function GlobUI({ args, result, status }) {
		const [isExpanded, setIsExpanded] = useState(false);
		const isRunning = status.type === "running";
		const pattern = args.pattern || "";

		// Count files from result
		const fileCount = result ? result.split("\n").filter((l) => l.trim()).length : null;

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
					<span className="shrink-0">Glob</span>
					<span className="text-muted-foreground/70 font-mono text-xs truncate min-w-0">
						({pattern})
					</span>
					{fileCount !== null && (
						<span className="text-xs text-muted-foreground/60 shrink-0">{fileCount} files</span>
					)}
				</Button>
				{isExpanded && result && (
					<pre className="ml-4 mt-1 max-h-40 overflow-auto rounded border border-border/40 bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
						{result}
					</pre>
				)}
			</div>
		);
	},
});
