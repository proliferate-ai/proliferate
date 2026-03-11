"use client";

import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { getFileName, getFilePath } from "@/lib/sessions/tool-utils";

interface EditDisplayProps {
	toolName: string;
	args: Record<string, unknown>;
	result?: unknown;
	status?: { type: string };
}

export function EditDisplay({ toolName, args, status }: EditDisplayProps) {
	const [expanded, setExpanded] = useState(false);
	const isRunning = status?.type === "running";
	const filePath = getFilePath(args);
	const fileName = filePath ? getFileName(filePath) : "file";
	const isEdit = toolName === "edit";

	const oldStr = args.old_string as string | undefined;
	const newStr = args.new_string as string | undefined;
	const contents = args.contents as string | undefined;

	const addedLines =
		isEdit && newStr ? newStr.split("\n").length : contents ? contents.split("\n").length : 0;
	const removedLines = isEdit && oldStr ? oldStr.split("\n").length : 0;

	return (
		<div className="my-1">
			<Button
				variant="ghost"
				size="sm"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center justify-between h-auto p-0"
			>
				<div className="flex min-w-0 items-center gap-1.5">
					<ChevronRight
						className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
					/>
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						className="shrink-0 text-muted-foreground"
					>
						<path
							d="M6.5 13.5l3-11M12.166 5.167l1.377 1.462a2 2 0 010 2.742l-1.377 1.462M3.833 10.833L2.456 9.371a2 2 0 010-2.742L3.833 5.167"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					<span className="text-sm font-medium text-foreground">
						{isEdit ? "Editing File" : "Creating File"}
					</span>
				</div>
			</Button>
			{expanded && (
				<div className="relative py-1 pr-1 pl-7">
					<div className="absolute top-0 bottom-0 left-[9.5px] w-px bg-border" />
					<div className="w-full min-w-0 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
						<Button
							variant="ghost"
							size="sm"
							className="flex w-full items-center gap-3 px-3 py-2 text-left h-auto"
							onClick={() => setExpanded(!expanded)}
						>
							<span className="truncate text-sm font-medium text-foreground" dir="rtl">
								{fileName}
							</span>
							<div className="flex shrink-0 items-center gap-1.5 ml-auto">
								{addedLines > 0 && (
									<span className="text-sm font-medium text-success">+{addedLines}</span>
								)}
								{removedLines > 0 && (
									<span className="text-sm font-medium text-destructive">-{removedLines}</span>
								)}
							</div>
						</Button>
						{isEdit && oldStr && newStr && (
							<div className="border-t border-border px-2 pb-2">
								<div className="w-full overflow-x-auto rounded-lg">
									<pre className="text-xs leading-relaxed">
										{oldStr.split("\n").map((line, i) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: static diff lines, never reorder
											<div
												key={`del-${i}`}
												className="bg-destructive/10 text-destructive px-2 py-0.5"
											>
												<span className="select-none text-destructive/50 mr-2">-</span>
												{line}
											</div>
										))}
										{newStr.split("\n").map((line, i) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: static diff lines, never reorder
											<div key={`add-${i}`} className="bg-success/10 text-success px-2 py-0.5">
												<span className="select-none text-success/50 mr-2">+</span>
												{line}
											</div>
										))}
									</pre>
								</div>
							</div>
						)}
						{!isEdit && contents && (
							<div className="border-t border-border px-2 pb-2">
								<pre className="text-xs leading-relaxed max-h-40 overflow-auto rounded-lg">
									{contents
										.slice(0, 2000)
										.split("\n")
										.map((line, i) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: static file content lines
											<div key={`line-${i}`} className="bg-success/10 text-success px-2 py-0.5">
												<span className="select-none text-success/50 mr-2">+</span>
												{line}
											</div>
										))}
									{contents.length > 2000 && (
										<div className="px-2 py-0.5 text-muted-foreground">... truncated</div>
									)}
								</pre>
							</div>
						)}
					</div>
				</div>
			)}
			{!expanded && isRunning && (
				<div className="relative py-1 pr-1 pl-7">
					<div className="absolute top-0 bottom-0 left-[9.5px] w-px bg-border" />
					<span className="text-xs text-muted-foreground">{filePath}</span>
				</div>
			)}
		</div>
	);
}
