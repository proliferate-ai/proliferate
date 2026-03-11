"use client";

import { OpenCodeIcon } from "@/components/ui/icons";
import { CREATION_MESSAGES, RESUME_MESSAGES } from "@/config/session-loading";
import { cn } from "@/lib/display/utils";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

function PulseLoader() {
	return (
		<div className="relative flex items-center justify-center w-16 h-16">
			{/* Outer ring — slow pulse */}
			<span className="absolute inset-0 rounded-full border border-muted-foreground/10 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" />
			{/* Middle ring — offset pulse */}
			<span className="absolute inset-2 rounded-full border border-muted-foreground/15 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_0.6s_infinite]" />
			{/* Inner dot — gentle breathe */}
			<span className="relative flex items-center justify-center w-8 h-8 rounded-full bg-muted/60 dark:bg-muted/40 animate-pulse">
				<OpenCodeIcon className="h-4 w-4 text-muted-foreground" />
			</span>
		</div>
	);
}

interface SessionLoadingShellProps {
	mode: "creating" | "resuming";
	repoName?: string;
	existingMessages?: Array<{
		id: string;
		role: "user" | "assistant";
		content: string;
	}>;
	initialPrompt?: string;
	showHeader?: boolean;
}

export function SessionLoadingShell({
	mode,
	repoName,
	existingMessages,
	initialPrompt,
	showHeader = true,
}: SessionLoadingShellProps) {
	const messages = mode === "creating" ? CREATION_MESSAGES : RESUME_MESSAGES;
	const [messageIndex, setMessageIndex] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setMessageIndex((prev) => (prev + 1) % messages.length);
		}, 2500);
		return () => clearInterval(interval);
	}, [messages.length]);

	const hasExistingMessages = existingMessages && existingMessages.length > 0;
	const showEagerPrompt = mode === "creating" && initialPrompt && !hasExistingMessages;

	return (
		<div className="flex h-full flex-col">
			{showHeader && (
				<div className="shrink-0 border-b bg-background px-4 py-3">
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-2">
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
							<span className="text-sm text-muted-foreground">
								{mode === "creating" ? "Starting session" : "Resuming"}
							</span>
						</div>
						{repoName && (
							<>
								<span className="text-muted-foreground">·</span>
								<span className="text-sm text-muted-foreground">{repoName}</span>
							</>
						)}
					</div>
				</div>
			)}

			<div className="flex-1 min-h-0 flex flex-col">
				<div className="flex-1 overflow-y-auto">
					{hasExistingMessages ? (
						<div className="py-4">
							{existingMessages.map((msg) => (
								<div key={msg.id} className="py-3 px-4">
									<div
										className={cn(
											"max-w-3xl mx-auto",
											msg.role === "user" && "flex flex-col items-end",
										)}
									>
										{msg.role === "user" ? (
											<div className="bg-muted rounded-2xl px-4 py-2 text-sm max-w-[80%]">
												<p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
											</div>
										) : (
											<div className="text-sm">
												<p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
											</div>
										)}
									</div>
								</div>
							))}
							<div className="py-4 px-4">
								<div className="max-w-3xl mx-auto">
									<BlinkingCursor />
								</div>
							</div>
						</div>
					) : showEagerPrompt ? (
						<div className="py-4">
							<div className="py-3 px-4">
								<div className="max-w-3xl mx-auto flex flex-col items-end">
									<div className="bg-muted rounded-2xl px-4 py-2 text-sm max-w-[80%]">
										<p className="leading-relaxed whitespace-pre-wrap">{initialPrompt}</p>
									</div>
								</div>
							</div>
							<div className="py-4 px-4">
								<div className="max-w-3xl mx-auto">
									<BlinkingCursor />
								</div>
							</div>
						</div>
					) : (
						<div className="flex h-full flex-col items-center justify-center p-8 text-center gap-6">
							<PulseLoader />
							<p
								key={messageIndex}
								className="text-[13px] text-muted-foreground animate-in fade-in duration-700"
							>
								{messages[messageIndex]}
							</p>
						</div>
					)}
				</div>

				<div className="shrink-0 p-4">
					<div className="max-w-3xl mx-auto w-full">
						<div className="flex flex-col rounded-2xl border bg-muted/40 dark:bg-chat-input opacity-40">
							<div className="px-4 py-3 text-sm text-muted-foreground">Message...</div>
							<div className="flex items-center justify-between px-2 py-1.5">
								<div className="flex items-center gap-1">
									<div className="h-8 w-8" />
								</div>
								<div className="flex items-center gap-1">
									<div className="h-7 w-7 rounded-lg bg-primary/40" />
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

const BlinkingCursor = () => <span className="inline-block w-2 h-4 bg-foreground animate-pulse" />;
