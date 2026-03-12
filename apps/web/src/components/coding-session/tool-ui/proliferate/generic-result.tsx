"use client";

import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

interface GenericResultProps {
	result?: unknown;
	collapsible?: boolean;
}

interface TruncatedResultInfo {
	originalSize: number | null;
	omittedKeys: number | null;
}

function formatResult(result: unknown): string {
	if (result === undefined || result === null) return "";
	if (typeof result === "string") {
		const trimmed = result.trim();
		// Try pretty-printing JSON strings
		try {
			return JSON.stringify(JSON.parse(trimmed), null, 2);
		} catch {
			return trimmed;
		}
	}
	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return String(result);
	}
}

function getTruncatedResultInfo(result: unknown): TruncatedResultInfo | null {
	if (!result || typeof result !== "object") return null;
	const obj = result as Record<string, unknown>;
	if (obj._truncated !== true) return null;
	return {
		originalSize: typeof obj._originalSize === "number" ? obj._originalSize : null,
		omittedKeys: typeof obj._omittedKeys === "number" ? obj._omittedKeys : null,
	};
}

export function GenericResult({ result, collapsible = true }: GenericResultProps) {
	const [expanded, setExpanded] = useState(false);
	const formatted = formatResult(result);
	const truncatedInfo = getTruncatedResultInfo(result);

	if (!formatted) return null;

	const truncated =
		formatted.length > 3000 ? `${formatted.slice(0, 3000)}\n... truncated` : formatted;

	if (!collapsible) {
		return (
			<div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
				{truncatedInfo && (
					<div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
						Result truncated by the CLI.
						{truncatedInfo.originalSize !== null && (
							<span className="ml-1">
								Original size: {truncatedInfo.originalSize.toLocaleString()} bytes.
							</span>
						)}
						{truncatedInfo.omittedKeys !== null && (
							<span className="ml-1">Omitted keys: {truncatedInfo.omittedKeys}.</span>
						)}
					</div>
				)}
				<pre className="px-3 py-2 text-xs text-muted-foreground max-h-60 overflow-auto whitespace-pre-wrap">
					{truncated}
				</pre>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
			{truncatedInfo && (
				<div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
					Result truncated by the CLI.
					{truncatedInfo.originalSize !== null && (
						<span className="ml-1">
							Original size: {truncatedInfo.originalSize.toLocaleString()} bytes.
						</span>
					)}
					{truncatedInfo.omittedKeys !== null && (
						<span className="ml-1">Omitted keys: {truncatedInfo.omittedKeys}.</span>
					)}
				</div>
			)}
			<Button
				variant="ghost"
				size="sm"
				onClick={() => setExpanded(!expanded)}
				className="h-auto w-full justify-start gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
			>
				<ChevronRight
					className={`h-3 w-3 shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
				/>
				<span>Show result</span>
			</Button>
			{expanded && (
				<div className="border-t border-border">
					<pre className="px-3 py-2 text-xs text-muted-foreground max-h-60 overflow-auto whitespace-pre-wrap">
						{truncated}
					</pre>
				</div>
			)}
		</div>
	);
}
