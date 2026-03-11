"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";

interface ShellDisplayProps {
	args: Record<string, unknown>;
	result?: unknown;
	status?: { type: string };
}

export function ShellDisplay({ args, result, status }: ShellDisplayProps) {
	const [expanded, setExpanded] = useState(false);
	const isRunning = status?.type === "running";
	const command = (args.command as string) ?? "";
	const displayCmd = command.length > 60 ? `${command.slice(0, 57)}...` : command;
	const output = typeof result === "string" ? result.trim() : null;

	return (
		<div className="my-1">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-1.5"
			>
				<ChevronRight
					className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
				/>
				{isRunning ? (
					<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
				) : (
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						className="shrink-0 text-muted-foreground"
					>
						<rect
							x="2"
							y="3"
							width="12"
							height="10"
							rx="2"
							stroke="currentColor"
							strokeWidth="1.5"
						/>
						<path
							d="M5 7l2 1.5L5 10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<path d="M9 10h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					</svg>
				)}
				<span className="text-sm font-medium text-foreground">Terminal</span>
			</button>
			<div className="relative py-1 pr-1 pl-7">
				<div className="absolute top-0 bottom-0 left-[9.5px] w-px bg-border" />
				<div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
					<div className="px-3 py-2 font-mono text-xs text-muted-foreground truncate">
						<span className="text-foreground/40 select-none">$ </span>
						{displayCmd}
					</div>
					{expanded && output && (
						<div className="border-t border-border">
							<pre className="px-3 py-2 text-xs text-muted-foreground max-h-40 overflow-auto whitespace-pre-wrap">
								{output.slice(0, 3000)}
								{output.length > 3000 && "\n... truncated"}
							</pre>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
