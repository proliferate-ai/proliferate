"use client";

import { cn } from "@/lib/utils";
import { Check, Circle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const RESUME_MESSAGES = [
	"Waking up your session...",
	"Restoring your workspace...",
	"Reconnecting the dots...",
	"Picking up where you left off...",
	"Dusting off the code...",
	"Rehydrating the environment...",
	"Getting back in the zone...",
];

/** Steps shown during session creation with artificial timer-based progression */
const CREATION_STEPS = [
	{ label: "Checking account", duration: 0 },
	{ label: "Setting up environment", duration: 2000 },
	{ label: "Cloning repositories", duration: 6000 },
	{ label: "Starting sandbox", duration: 14000 },
	{ label: "Almost ready", duration: 28000 },
];

interface SessionLoadingShellProps {
	mode: "creating" | "resuming";
	repoName?: string;
	/** Which mutation is active — drives step progression */
	stage?: "preparing" | "provisioning";
	/** Pass existing messages to display while loading (for resume) */
	existingMessages?: Array<{
		id: string;
		role: "user" | "assistant";
		content: string;
	}>;
	/** Initial prompt to show eagerly (for setup sessions) */
	initialPrompt?: string;
}

export function SessionLoadingShell({
	mode,
	repoName,
	stage,
	existingMessages,
	initialPrompt,
}: SessionLoadingShellProps) {
	const [messageIndex, setMessageIndex] = useState(0);
	const [activeStep, setActiveStep] = useState(0);
	const [provisioningStart, setProvisioningStart] = useState<number | null>(null);

	// Track when provisioning stage begins for timer-based step advancement
	useEffect(() => {
		if (stage === "provisioning" && provisioningStart === null) {
			setProvisioningStart(Date.now());
			setActiveStep(1); // Jump past "Checking account"
		}
	}, [stage, provisioningStart]);

	// Advance steps on timers once provisioning starts
	useEffect(() => {
		if (provisioningStart === null) return;

		const timers = CREATION_STEPS.slice(2).map((step, i) => {
			const elapsed = Date.now() - provisioningStart;
			const remaining = step.duration - elapsed;
			if (remaining <= 0) {
				setActiveStep((prev) => Math.max(prev, i + 2));
				return null;
			}
			return setTimeout(() => setActiveStep((prev) => Math.max(prev, i + 2)), remaining);
		});

		return () => {
			for (const timer of timers) {
				if (timer) clearTimeout(timer);
			}
		};
	}, [provisioningStart]);

	// Rotate through resume messages
	useEffect(() => {
		if (mode !== "resuming") return;
		const interval = setInterval(() => {
			setMessageIndex((prev) => (prev + 1) % RESUME_MESSAGES.length);
		}, 2500);
		return () => clearInterval(interval);
	}, [mode]);

	const hasExistingMessages = existingMessages && existingMessages.length > 0;
	const showEagerPrompt = mode === "creating" && initialPrompt && !hasExistingMessages;
	const showSteps = mode === "creating" && stage && !hasExistingMessages && !showEagerPrompt;

	return (
		<div className="flex h-full flex-col">
			{/* Header skeleton - matches SessionHeader structure */}
			<div className="shrink-0 border-b bg-background px-4 py-3">
				<div className="flex items-center justify-between">
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
			</div>

			{/* Main content - matches Thread structure */}
			<div className="flex-1 min-h-0 flex flex-col">
				{/* Scrollable message area */}
				<div className="flex-1 overflow-y-auto">
					{hasExistingMessages ? (
						// Show existing conversation history
						<div className="py-4">
							{existingMessages.map((msg) => (
								<div key={msg.id} className="py-3 px-4">
									<div
										className={cn(
											"max-w-3xl mx-auto",
											msg.role === "user" ? "flex flex-col items-end" : "",
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
							{/* Show blinking cursor for resuming state */}
							<div className="py-4 px-4">
								<div className="max-w-3xl mx-auto">
									<BlinkingCursor />
								</div>
							</div>
						</div>
					) : showSteps ? (
						// Step-based progress for session creation
						<div className="flex h-full flex-col items-center justify-center p-8">
							<div className="space-y-3 w-full max-w-xs">
								{CREATION_STEPS.map((step, i) => (
									<div key={step.label} className="flex items-center gap-3">
										{i < activeStep ? (
											<Check className="h-4 w-4 text-green-500 shrink-0" />
										) : i === activeStep ? (
											<Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
										) : (
											<Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" />
										)}
										<span
											className={cn(
												"text-sm",
												i < activeStep
													? "text-muted-foreground"
													: i === activeStep
														? "text-foreground font-medium"
														: "text-muted-foreground/40",
											)}
										>
											{step.label}
											{i === activeStep && "..."}
										</span>
									</div>
								))}
							</div>
						</div>
					) : showEagerPrompt ? (
						// Show the initial prompt eagerly for setup sessions
						<div className="py-4">
							<div className="py-3 px-4">
								<div className="max-w-3xl mx-auto flex flex-col items-end">
									<div className="bg-muted rounded-2xl px-4 py-2 text-sm max-w-[80%]">
										<p className="leading-relaxed whitespace-pre-wrap">{initialPrompt}</p>
									</div>
								</div>
							</div>
							{/* Blinking cursor indicating assistant is thinking */}
							<div className="py-4 px-4">
								<div className="max-w-3xl mx-auto">
									<BlinkingCursor />
								</div>
							</div>
						</div>
					) : (
						// Fallback: rotating message for resume or no-stage creating
						<div className="flex h-full flex-col items-center justify-center p-8 text-center">
							<div className="space-y-4">
								<p
									key={messageIndex}
									className="text-muted-foreground animate-in fade-in duration-500"
								>
									{RESUME_MESSAGES[messageIndex]}
								</p>
							</div>
						</div>
					)}
				</div>

				{/* Fixed composer area - disabled but matching real structure */}
				<div className="shrink-0 p-4">
					<div className="max-w-3xl mx-auto w-full">
						<div className="flex flex-col rounded-2xl border bg-muted/40 dark:bg-chat-input opacity-50">
							<div className="px-4 py-3 text-sm text-muted-foreground">Message...</div>
							<div className="flex items-center justify-between px-2 py-1.5">
								<div className="flex items-center gap-1">
									{/* Placeholder for attachment buttons */}
									<div className="h-8 w-8" />
								</div>
								<div className="flex items-center gap-1">
									<div className="h-7 w-7 rounded-lg bg-primary/50" />
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
