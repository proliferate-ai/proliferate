"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { ProliferateToolCard } from "./proliferate-tool-card";

type SpawnChildArgs = {
	title?: string;
	instructions?: string;
	repo?: string;
};

type SpawnChildResult = {
	session_id?: string;
	title?: string;
	status?: string;
};

function parseResult(raw: string | undefined): SpawnChildResult | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export const SpawnChildToolUI = makeAssistantToolUI<SpawnChildArgs, string>({
	toolName: "spawn_child_task",
	render: function SpawnChildUI({ args, result, status }) {
		const isRunning = status.type === "running";
		const parsed = parseResult(result);
		const sessionId = parsed?.session_id;
		const title = args.title || parsed?.title || "Child session";

		return (
			<ProliferateToolCard label="Spawn coding session" status={isRunning ? "running" : "success"}>
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-2">
						<span className="font-medium text-foreground">{title}</span>
						{isRunning && (
							<span className="flex items-center gap-1 text-muted-foreground">
								<Loader2 className="h-3 w-3 animate-spin" />
								Starting...
							</span>
						)}
					</div>
					{args.instructions && (
						<p className="text-muted-foreground line-clamp-2">{args.instructions}</p>
					)}
					{sessionId && (
						<Link
							href={`/workspace/${sessionId}`}
							className="inline-flex items-center gap-1 text-primary hover:underline w-fit"
						>
							Open session
							<ExternalLink className="h-3 w-3" />
						</Link>
					)}
				</div>
			</ProliferateToolCard>
		);
	},
});
