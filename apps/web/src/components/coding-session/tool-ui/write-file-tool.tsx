"use client";

import { Button } from "@/components/ui/button";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";

type WriteFileArgs = {
	filePath?: string;
	file_path?: string;
	content?: string;
};

export const WriteFileToolUI = makeAssistantToolUI<WriteFileArgs, string>({
	toolName: "write",
	render: function WriteFileUI({ args, result, status }) {
		const [isExpanded, setIsExpanded] = useState(false);
		const isRunning = status.type === "running";
		const isComplete = status.type !== "running";
		const filePath = args.filePath || args.file_path || "";
		const content = args.content || "";

		const lineCount = content ? content.split("\n").length : 0;

		return (
			<div className="ml-4 my-0.5">
				<Button
					variant="ghost"
					onClick={() => setIsExpanded(!isExpanded)}
					className="h-auto p-0 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-transparent group max-w-full"
				>
					{isRunning ? (
						<Loader2 className="h-3 w-3 animate-spin shrink-0" />
					) : isExpanded ? (
						<ChevronDown className="h-3 w-3 shrink-0" />
					) : (
						<ChevronRight className="h-3 w-3 shrink-0" />
					)}
					<span className="shrink-0">Write</span>
					<span className="text-muted-foreground/70 truncate min-w-0">({filePath})</span>
					{isComplete && (
						<span className="text-xs text-muted-foreground/60 shrink-0">{lineCount} lines</span>
					)}
				</Button>
				{isExpanded && content && (
					<pre className="ml-4 mt-1 max-h-40 overflow-auto rounded border border-border/40 bg-muted/30 p-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
						{content.slice(0, 2000)}
						{content.length > 2000 && "\n..."}
					</pre>
				)}
			</div>
		);
	},
});
