"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { getFilePath, getToolLabel } from "../config";

interface LookupTool {
	toolName: string;
	args: Record<string, unknown>;
	result?: unknown;
	status?: { type: string };
}

interface ReadingSummaryProps {
	tools: LookupTool[];
	hasRunning: boolean;
}

export function ReadingSummary({ tools, hasRunning }: ReadingSummaryProps) {
	const [expanded, setExpanded] = useState(false);

	const label = hasRunning
		? `Reading${tools.length > 1 ? ` (${tools.length})` : ""}...`
		: `Read ${tools.length} ${tools.length === 1 ? "file" : "files"}`;

	return (
		<div className="my-1">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<ChevronRight
					className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
				/>
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="none"
					className="shrink-0 text-muted-foreground"
				>
					<path
						d="M4.5 1.834h7c.736 0 1.333.597 1.333 1.333v9.666c0 .736-.597 1.334-1.333 1.334h-7a1.333 1.333 0 01-1.333-1.334V3.167c0-.736.597-1.333 1.333-1.333z"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
					<path
						d="M5.833 4.667h4.334M5.833 7.334h4.334M5.833 10h2.334"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				<span className="font-medium text-foreground">{label}</span>
			</button>
			{expanded && (
				<div className="relative py-1 pr-1 pl-7">
					<div className="absolute top-0 bottom-0 left-[9.5px] w-px bg-border" />
					<div className="flex flex-col gap-0.5">
						{tools.map((tool, i) => {
							const path = getFilePath(tool.args);
							return (
								<span
									key={(tool.args?.toolCallId as string) ?? i}
									className="text-xs text-muted-foreground truncate"
								>
									{path ?? getToolLabel(tool.toolName)}
								</span>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
