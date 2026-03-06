"use client";

import { Button } from "@/components/ui/button";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { ProliferateToolCard } from "./proliferate-tool-card";

type FileEditArgs = {
	filePath?: string;
	file_path?: string;
	oldString?: string;
	old_string?: string;
	newString?: string;
	new_string?: string;
};

export const FileEditToolUI = makeAssistantToolUI<FileEditArgs, string>({
	toolName: "edit",
	render: function FileEditUI({ args, result: _result, status }) {
		const [isExpanded, setIsExpanded] = useState(false);
		const isRunning = status.type === "running";
		const isComplete = status.type !== "running";
		const filePath = args.filePath || args.file_path || "";
		const oldString = args.oldString || args.old_string || "";
		const newString = args.newString || args.new_string || "";

		// Count lines changed
		const linesRemoved = oldString ? oldString.split("\n").length : 0;
		const linesAdded = newString ? newString.split("\n").length : 0;

		return (
			<ProliferateToolCard label="Edit file" status={isRunning ? "running" : "success"}>
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
					<span className="shrink-0">edit</span>
					<span className="text-muted-foreground/70 truncate min-w-0">({filePath})</span>
					{isComplete && (
						<span className="text-xs shrink-0">
							<span className="text-destructive">-{linesRemoved}</span>
							<span className="text-muted-foreground/60">/</span>
							<span className="text-success">+{linesAdded}</span>
						</span>
					)}
				</Button>
				{isExpanded && (oldString || newString) && (
					<div className="mt-1 max-h-56 overflow-auto rounded border border-border/40 bg-background p-2 font-mono text-xs">
						{oldString?.split("\n").map((line, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static list from split
							<div key={`old-${i}`} className="bg-destructive/10 px-1 py-0.5 text-destructive">
								- {line}
							</div>
						))}
						{newString?.split("\n").map((line, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static list from split
							<div key={`new-${i}`} className="bg-success/10 px-1 py-0.5 text-success">
								+ {line}
							</div>
						))}
					</div>
				)}
			</ProliferateToolCard>
		);
	},
});
