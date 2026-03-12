"use client";

import { ConnectorIcon } from "@/components/integrations/connector-icon";
import { Button } from "@/components/ui/button";
import { GithubIcon, LinearIcon, SentryIcon, SlackIcon } from "@/components/ui/icons";
import { cn } from "@/lib/display/utils";
import { CheckCircle, ChevronRight, Loader2, XCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { GenericResult } from "./generic-result";

interface ActionCardShellProps {
	/**
	 * Provider icon key: "gmail", "linear", "slack", "github", "sentry",
	 * or any ConnectorIcon preset key. Falls back to the MCP icon.
	 */
	iconKey: string;
	label: string;
	status?: { type: string };
	meta?: string | null;
	command?: string | null;
	rawResult?: unknown;
	errorMessage?: string | null;
	children?: ReactNode;
}

function ActionIcon({ iconKey, className }: { iconKey: string; className?: string }) {
	switch (iconKey) {
		case "linear":
			return <LinearIcon className={className} />;
		case "github":
			return <GithubIcon className={className} />;
		case "sentry":
			return <SentryIcon className={className} />;
		case "slack":
			return <SlackIcon className={className} />;
		default:
			// ConnectorIcon handles gmail, notion, google-calendar, etc.
			// Falls back to McpIcon for unknown keys.
			return <ConnectorIcon presetKey={iconKey} size="sm" className={className} />;
	}
}

export function ActionCardShell({
	iconKey,
	label,
	status,
	meta,
	command,
	rawResult,
	errorMessage,
	children,
}: ActionCardShellProps) {
	const isRunning = status?.type === "running";
	const hasError = Boolean(errorMessage);
	const [showCommand, setShowCommand] = useState(false);
	const [showRawResult, setShowRawResult] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const hasCommand = Boolean(command && command.trim().length > 0);
	const hasRawResult = rawResult !== undefined && rawResult !== null;
	const hasContent = Boolean(meta || errorMessage || children || hasCommand || hasRawResult);
	const displayCommand =
		command && command.length > 52 ? `${command.slice(0, 49)}...` : (command ?? null);

	return (
		<div className="my-1">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				disabled={!hasContent}
				onClick={() => hasContent && setExpanded((value) => !value)}
				className="flex w-full items-center gap-1.5 h-auto p-0 text-left"
			>
				<ChevronRight
					className={cn(
						"h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
						expanded && "rotate-90",
					)}
				/>
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="shrink-0">
						{isRunning ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						) : hasError ? (
							<XCircle className="h-3.5 w-3.5 text-destructive" />
						) : (
							<CheckCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
						)}
					</span>
					<ActionIcon
						iconKey={iconKey}
						className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground")}
					/>
					<span
						className={cn(
							"text-xs font-medium shrink-0",
							hasError ? "text-destructive" : "text-foreground",
						)}
					>
						{label}
					</span>
					{displayCommand && (
						<span className="min-w-0 truncate font-mono text-xs text-muted-foreground/70">
							<span className="select-none">$ </span>
							{displayCommand}
						</span>
					)}
				</div>
			</Button>
			{expanded && hasContent && (
				<div className="relative py-1 pr-1 pl-7">
					<div className="absolute top-0 bottom-0 left-[9.5px] w-px bg-border" />
					<div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
						<div className="px-3 py-2.5">
							{meta && <p className="text-[11px] text-muted-foreground">{meta}</p>}
							{errorMessage && (
								<p className={cn("text-xs", meta ? "mt-1" : "", "text-destructive")}>
									{errorMessage}
								</p>
							)}
						</div>
						{children && <div className="border-t border-border/60 px-3 py-2">{children}</div>}
						{(hasCommand || hasRawResult) && (
							<div className="border-t border-border/60 px-3 py-2">
								<div className="flex flex-wrap gap-1.5">
									{hasCommand && (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
											onClick={() => setShowCommand((value) => !value)}
										>
											<ChevronRight
												className={cn(
													"h-3 w-3 shrink-0 transition-transform",
													showCommand && "rotate-90",
												)}
											/>
											Show command
										</Button>
									)}
									{hasRawResult && (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
											onClick={() => setShowRawResult((value) => !value)}
										>
											<ChevronRight
												className={cn(
													"h-3 w-3 shrink-0 transition-transform",
													showRawResult && "rotate-90",
												)}
											/>
											Show raw result
										</Button>
									)}
								</div>
								{showCommand && hasCommand && (
									<pre className="mt-2 overflow-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
										<span className="text-foreground/40 select-none">$ </span>
										{command}
									</pre>
								)}
								{showRawResult && hasRawResult && (
									<div className="mt-2">
										<GenericResult result={rawResult} collapsible={false} />
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
