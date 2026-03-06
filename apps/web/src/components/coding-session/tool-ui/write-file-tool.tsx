"use client";

import { Button } from "@/components/ui/button";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { ProliferateToolCard } from "./proliferate-tool-card";

type WriteFileArgs = {
	filePath?: string;
	file_path?: string;
	content?: string;
};

export const WriteFileToolUI = makeAssistantToolUI<WriteFileArgs, string>({
	toolName: "write",
	render: function WriteFileUI({ args, result: _result, status }) {
		const [isExpanded, setIsExpanded] = useState(false);
		const isRunning = status.type === "running";
		const isComplete = status.type !== "running";
		const filePath = args.filePath || args.file_path || "";
		const content = args.content || "";

		const lineCount = content ? content.split("\n").length : 0;

		return (
			<ProliferateToolCard label="Write file" status={isRunning ? "running" : "success"}>
				<Button
					variant="ghost"
					onClick={() => setIsExpanded(!isExpanded)}
					className="h-auto p-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent group max-w-full"
				>
					{isExpanded ? (
						<ChevronDown className="h-3 w-3 shrink-0" />
					) : (
						<ChevronRight className="h-3 w-3 shrink-0" />
					)}
					<span className="shrink-0">write</span>
					<span className="text-muted-foreground/70 truncate min-w-0">({filePath})</span>
					{isComplete && (
						<span className="text-xs text-muted-foreground/60 shrink-0">{lineCount} lines</span>
					)}
				</Button>
				{isExpanded && content && (
					<div className="mt-1 max-h-56 overflow-auto rounded border border-border/40 bg-background p-2 font-mono text-xs">
						{content.split("\n").map((line, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static list from split
							<div key={`line-${i}`} className="bg-success/10 px-1 py-0.5 text-success">
								+ {line}
							</div>
						))}
					</div>
				)}
			</ProliferateToolCard>
		);
	},
});
