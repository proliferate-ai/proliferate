"use client";

import { Button } from "@/components/ui/button";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";

type ShellArgs = {
	command?: string;
};

export const ShellToolUI = makeAssistantToolUI<ShellArgs, string>({
	toolName: "bash",
	render: function ShellUI({ args, result, status }) {
		const [isExpanded, setIsExpanded] = useState(false);
		const isRunning = status.type === "running";
		const command = args.command || "";

		// Truncate long commands for display in parens
		const displayCommand = command.length > 50 ? `${command.slice(0, 47)}...` : command;
		// Trim result to handle placeholder space from empty results
		const trimmedResult = result?.trim();

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
					<span className="shrink-0">Bash</span>
					<span className="text-muted-foreground/70 font-mono text-xs truncate min-w-0">
						({displayCommand})
					</span>
				</Button>
				{isExpanded && trimmedResult && (
					<pre className="ml-4 mt-1 max-h-40 overflow-auto rounded border border-border/40 bg-muted/30 p-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
						{trimmedResult.slice(0, 3000)}
						{trimmedResult.length > 3000 && "\n..."}
					</pre>
				)}
			</div>
		);
	},
});
