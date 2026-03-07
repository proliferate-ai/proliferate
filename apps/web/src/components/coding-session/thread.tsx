"use client";

import { ModelSelector } from "@/components/automations/model-selector";
import { ReasoningSelector } from "@/components/dashboard/reasoning-selector";
import { type Provider, ProviderIcon } from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { BlocksIcon } from "@/components/ui/icons";
import { RoundIconActionButton } from "@/components/ui/round-icon-action-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionAvailableActions } from "@/hooks/actions/use-actions";
import { useCreateFollowUp } from "@/hooks/sessions/use-follow-up";
import { cn } from "@/lib/display/utils";
import { useDashboardStore } from "@/stores/dashboard";
import {
	ComposerPrimitive,
	MessagePrimitive,
	ThreadPrimitive,
	useComposer,
	useComposerRuntime,
} from "@assistant-ui/react";
import type { ActionApprovalRequestMessage } from "@proliferate/shared";
import type { ModelId } from "@proliferate/shared";
import type { Session } from "@proliferate/shared/contracts/sessions";
import type { OverallWorkState } from "@proliferate/shared/sessions";
import { ArrowUp, Camera, ChevronDown, ChevronRight, Loader2, Square } from "lucide-react";
import Link from "next/link";
import type { FC } from "react";
import { useCallback, useState } from "react";
import Markdown from "react-markdown";
import { InboxTray } from "./inbox-tray";
import { allToolUIs } from "./tool-ui/all-tool-uis";
import { ProliferateToolCard } from "./tool-ui/proliferate-tool-card";

// Shared markdown components for consistent rendering
interface MarkdownContentProps {
	text: string;
	variant?: "user" | "assistant";
}

interface ProliferateCommandSegment {
	type: "command";
	command: string;
	actionLabel: string;
	url: string | null;
}

interface MarkdownSegment {
	type: "markdown";
	text: string;
}

type AssistantContentSegment = ProliferateCommandSegment | MarkdownSegment;

function getProliferateCommandFromLine(line: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) return null;

	const unwrapped = trimmed
		.replace(/^[-*]\s+/, "")
		.replace(/^\d+\.\s+/, "")
		.replace(/^`+|`+$/g, "");
	const match = unwrapped.match(/(?:^|\()((?:@?proliferate)\s+[^\n)`]+)/i);
	if (!match) return null;
	return match[1].replace(/^@/i, "").trim();
}

function getProliferateActionLabel(command: string): string {
	const normalized = command.toLowerCase();
	if (normalized.includes("actions list")) return "List actions";
	if (normalized.includes("sentry action")) return "Run Sentry action";
	if (normalized.includes("create pr") || normalized.includes("pr create"))
		return "Create pull request";
	if (normalized.includes("env set")) return "Set environment values";
	if (normalized.includes("save_snapshot")) return "Save snapshot";
	return "Proliferate command";
}

function parseAssistantContentSegments(text: string): AssistantContentSegment[] {
	const lines = text.split("\n");
	const segments: AssistantContentSegment[] = [];
	let markdownBuffer: string[] = [];

	const flushMarkdown = () => {
		const chunk = markdownBuffer.join("\n").trim();
		if (chunk) segments.push({ type: "markdown", text: chunk });
		markdownBuffer = [];
	};

	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		const command = getProliferateCommandFromLine(line);
		if (!command) {
			markdownBuffer.push(line);
			index += 1;
			continue;
		}

		flushMarkdown();
		let nextUrl: string | null = null;
		for (let lookAhead = index + 1; lookAhead < Math.min(lines.length, index + 4); lookAhead += 1) {
			const urlMatch = lines[lookAhead].match(/https?:\/\/\S+/i);
			if (urlMatch) {
				nextUrl = urlMatch[0];
				index = lookAhead;
				break;
			}
			if (!lines[lookAhead].trim()) break;
		}

		segments.push({
			type: "command",
			command,
			actionLabel: getProliferateActionLabel(command),
			url: nextUrl,
		});
		index += 1;
	}

	flushMarkdown();
	return segments;
}

const AssistantCommandCard: FC<{
	actionLabel: string;
	command: string;
	url: string | null;
}> = ({ actionLabel, command, url }) => (
	<div className="my-2 rounded-md border border-border/70 bg-muted/30 p-2.5">
		<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
			{actionLabel}
		</p>
		<code className="mt-1 block rounded bg-background px-2 py-1 text-xs font-mono text-foreground">
			{command}
		</code>
		{url && (
			<a
				href={url}
				target="_blank"
				rel="noreferrer"
				className="mt-1.5 inline-block text-xs text-primary hover:underline"
			>
				Open result
			</a>
		)}
	</div>
);

const MarkdownContent: FC<MarkdownContentProps> = ({ text, variant = "assistant" }) => {
	const isUser = variant === "user";
	const assistantSegments = !isUser ? parseAssistantContentSegments(text) : null;
	const hasAssistantCommand =
		assistantSegments?.some((segment) => segment.type === "command") ?? false;

	if (!isUser && assistantSegments && hasAssistantCommand) {
		return (
			<div>
				{assistantSegments.map((segment, index) =>
					segment.type === "command" ? (
						<AssistantCommandCard
							key={`assistant-command-${segment.command}-${index}`}
							actionLabel={segment.actionLabel}
							command={segment.command}
							url={segment.url}
						/>
					) : (
						<MarkdownContent
							key={`assistant-markdown-${index}`}
							text={segment.text}
							variant="assistant"
						/>
					),
				)}
			</div>
		);
	}

	return (
		<Markdown
			components={{
				p: ({ children }) => (
					<p className={cn("leading-relaxed", isUser ? "mb-1.5 last:mb-0" : "mb-3 last:mb-0")}>
						{children}
					</p>
				),
				h1: ({ children }) => (
					<h1 className={cn("font-semibold", isUser ? "text-lg mt-3 mb-1" : "text-xl mt-4 mb-2")}>
						{children}
					</h1>
				),
				h2: ({ children }) => (
					<h2 className={cn("font-semibold", isUser ? "text-base mt-3 mb-1" : "text-lg mt-4 mb-2")}>
						{children}
					</h2>
				),
				h3: ({ children }) => (
					<h3 className={cn("font-semibold", isUser ? "text-sm mt-2 mb-1" : "text-base mt-3 mb-2")}>
						{children}
					</h3>
				),
				ul: ({ children }) => (
					<ul
						className={cn("list-disc list-inside", isUser ? "mb-2 space-y-0.5" : "mb-3 space-y-1")}
					>
						{children}
					</ul>
				),
				ol: ({ children }) => (
					<ol
						className={cn(
							"list-decimal list-inside",
							isUser ? "mb-2 space-y-0.5" : "mb-3 space-y-1",
						)}
					>
						{children}
					</ol>
				),
				li: ({ children }) => <li className="leading-relaxed">{children}</li>,
				code: ({ className, children }) => {
					const isBlock = className?.includes("language-");
					const bgClass = isUser ? "bg-background/50" : "bg-muted";
					return isBlock ? (
						<pre
							className={cn(
								bgClass,
								"rounded-lg overflow-x-auto",
								isUser ? "p-2 my-2" : "p-3 my-3",
							)}
						>
							<code className="text-xs font-mono">{children}</code>
						</pre>
					) : (
						<code
							className={cn(
								bgClass,
								"rounded-md text-xs font-mono",
								isUser ? "px-1 py-0.5" : "px-1.5 py-0.5",
							)}
						>
							{children}
						</code>
					);
				},
				pre: ({ children }) => <>{children}</>,
				strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
				blockquote: ({ children }) => (
					<blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic my-3">
						{children}
					</blockquote>
				),
			}}
		>
			{text}
		</Markdown>
	);
};

// Context selectors (model selector) - left side of toolbar
interface ComposerActionsLeftProps {
	selectedModel: ModelId;
	reasoningEffort: "quick" | "normal" | "deep";
	onModelChange: (modelId: ModelId) => void;
	onReasoningEffortChange: (effort: "quick" | "normal" | "deep") => void;
}

const ComposerActionsLeft: FC<ComposerActionsLeftProps> = ({
	selectedModel,
	reasoningEffort,
	onModelChange,
	onReasoningEffortChange,
}) => (
	<div className="flex items-center gap-1">
		<ModelSelector modelId={selectedModel} onChange={onModelChange} variant="ghost" />
		<ReasoningSelector
			modelId={selectedModel}
			effort={reasoningEffort}
			onChange={onReasoningEffortChange}
		/>
	</div>
);

// Action buttons (send/cancel) - right side of toolbar
interface ComposerActionsRightProps {
	hasContent: boolean;
	isTerminal: boolean;
	onTerminalSend: () => void;
}

const ComposerActionsRight: FC<ComposerActionsRightProps> = ({
	hasContent,
	isTerminal,
	onTerminalSend,
}) => (
	<div className="flex items-center gap-0.5">
		<ThreadPrimitive.If running={false}>
			{isTerminal ? (
				<RoundIconActionButton
					ariaLabel="Send message"
					icon={<ArrowUp className="h-4 w-4" />}
					onClick={onTerminalSend}
					disabled={!hasContent}
				/>
			) : (
				<ComposerPrimitive.Send asChild>
					<RoundIconActionButton ariaLabel="Send message" icon={<ArrowUp className="h-4 w-4" />} />
				</ComposerPrimitive.Send>
			)}
		</ThreadPrimitive.If>
		<ThreadPrimitive.If running>
			<ComposerPrimitive.Cancel asChild>
				<RoundIconActionButton
					ariaLabel="Stop generation"
					intent="muted"
					icon={<Square className="h-3 w-3 fill-current" />}
				/>
			</ComposerPrimitive.Cancel>
		</ThreadPrimitive.If>
	</div>
);

interface SessionStateForComposer {
	sessionId: string;
	status: Session["status"];
	overallWorkState: OverallWorkState;
	outcome?: string | null;
	workerId?: string | null;
}

interface ThreadProps {
	title?: string;
	description?: string;
	onSnapshot?: () => void;
	isSnapshotting?: boolean;
	showSnapshot?: boolean;
	sessionId?: string;
	token?: string | null;
	statusMessage?: string | null;
	pendingApprovals?: ActionApprovalRequestMessage["payload"][];
	runId?: string;
	sessionState?: SessionStateForComposer;
}

export const Thread: FC<ThreadProps> = ({
	title = "What would you like to build?",
	description = "Describe what you want to create, fix, or explore in your codebase.",
	onSnapshot,
	isSnapshotting,
	showSnapshot = false,
	sessionId,
	token,
	statusMessage,
	pendingApprovals,
	runId,
	sessionState,
}) => {
	const [showStatusDetails, setShowStatusDetails] = useState(false);

	return (
		<ThreadPrimitive.Root className="flex h-full flex-col">
			{/* Scrollable message area */}
			<ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
				<ThreadPrimitive.Empty>
					<div className="flex h-full flex-col items-center justify-center p-8 text-center">
						<div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted mb-4">
							<BlocksIcon className="h-5 w-5 text-foreground" />
						</div>
						<p className="text-lg font-semibold tracking-tight text-foreground">{title}</p>
						<p className="mt-1.5 text-sm text-muted-foreground max-w-sm">{description}</p>
					</div>
				</ThreadPrimitive.Empty>

				<ThreadPrimitive.Messages
					components={{
						UserMessage,
						AssistantMessage,
					}}
				/>
			</ThreadPrimitive.Viewport>

			{/* Attention tray — between viewport and composer */}
			{sessionId && (
				<InboxTray
					sessionId={sessionId}
					token={token ?? null}
					pendingApprovals={pendingApprovals ?? []}
					runId={runId}
				/>
			)}

			{statusMessage && (
				<div className="shrink-0 px-3 pt-2">
					<div className="mx-auto max-w-2xl rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-auto w-full justify-start gap-2 px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
							onClick={() => setShowStatusDetails((value) => !value)}
						>
							<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
							<span className="truncate">{statusMessage}</span>
							{showStatusDetails ? (
								<ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0" />
							) : (
								<ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />
							)}
						</Button>
						{showStatusDetails && (
							<p className="mt-2 text-[11px] text-muted-foreground">
								Long-running work is active. You can keep chatting while this runs.
							</p>
						)}
					</div>
				</div>
			)}

			{/* Fixed composer at bottom */}
			<div className="shrink-0 px-3 pb-3 pt-2">
				{showSnapshot && onSnapshot && (
					<div className="flex justify-center mb-3">
						<Button
							variant="ghost"
							size="sm"
							onClick={onSnapshot}
							disabled={isSnapshotting}
							className="gap-2 text-muted-foreground hover:text-foreground"
						>
							<Camera className="h-4 w-4" />
							{isSnapshotting ? "Saving..." : "Save Snapshot"}
						</Button>
					</div>
				)}
				<Composer sessionState={sessionState} sessionId={sessionId} token={token} />
			</div>

			{allToolUIs.map(({ id, Component }) => (
				<Component key={id} />
			))}
		</ThreadPrimitive.Root>
	);
};

type ComposerMode = "normal" | "paused" | "waiting_approval" | "completed" | "failed";

function deriveComposerMode(sessionState?: SessionStateForComposer): ComposerMode {
	if (!sessionState) return "normal";

	const { status, overallWorkState, outcome } = sessionState;

	if (status.agentState === "waiting_approval") return "waiting_approval";

	if (status.terminalState === "failed" || status.agentState === "errored") {
		return "failed";
	}

	if (overallWorkState === "done" || outcome) {
		return "completed";
	}

	if (status.sandboxState === "paused" || overallWorkState === "dormant") return "paused";

	return "normal";
}

const COMPOSER_LABELS: Record<ComposerMode, string | null> = {
	normal: null,
	paused: "Session is paused. Sending a message will resume it.",
	waiting_approval: "Waiting for approval. Message will be delivered after resolution.",
	completed: "Session completed. Sending will start a new continuation.",
	failed: "Session failed. Sending will start a new rerun.",
};

const COMPOSER_PLACEHOLDERS: Record<ComposerMode, string> = {
	normal: "Send a follow-up...",
	paused: "Send a message to resume...",
	waiting_approval: "Queue a message...",
	completed: "Start a continuation...",
	failed: "Start a rerun...",
};

interface ComposerProps {
	sessionState?: SessionStateForComposer;
	sessionId?: string;
	token?: string | null;
}

function getProviderForIntegration(integration: string): Provider | null {
	if (integration === "github" || integration === "jira" || integration === "linear") {
		return integration;
	}
	if (integration === "posthog" || integration === "sentry" || integration === "slack") {
		return integration;
	}
	return null;
}

const EnabledActionsStrip: FC<{ sessionId?: string; token?: string | null }> = ({
	sessionId,
	token,
}) => {
	const { data: integrations } = useSessionAvailableActions(sessionId ?? "", token ?? null);
	const enabledIntegrations = integrations?.filter((entry) => entry.actions.length > 0) ?? [];
	const enabledActionCount = enabledIntegrations.reduce(
		(total, entry) => total + entry.actions.length,
		0,
	);

	if (!sessionId || !token || enabledIntegrations.length === 0) {
		return null;
	}

	const visibleIntegrations = enabledIntegrations.slice(0, 3);
	const overflowCount = Math.max(enabledIntegrations.length - visibleIntegrations.length, 0);

	return (
		<TooltipProvider>
			<div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
				<div className="flex items-center gap-2">
					<div className="flex items-center -space-x-1">
						{visibleIntegrations.map((entry) => {
							const provider = getProviderForIntegration(entry.integration);
							const tooltipText = `${entry.displayName}: ${entry.actions.length} actions enabled`;
							return (
								<Tooltip key={entry.integrationId}>
									<TooltipTrigger asChild>
										<div className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-foreground">
											{provider ? (
												<ProviderIcon provider={provider} size="sm" />
											) : (
												<BlocksIcon className="h-3.5 w-3.5" />
											)}
										</div>
									</TooltipTrigger>
									<TooltipContent>{tooltipText}</TooltipContent>
								</Tooltip>
							);
						})}
						{overflowCount > 0 && (
							<div className="ml-1 flex h-6 items-center rounded-full border border-border bg-background px-2 text-[11px] text-muted-foreground">
								+{overflowCount}
							</div>
						)}
					</div>
					<span className="text-xs text-muted-foreground">
						{enabledActionCount} actions enabled
					</span>
				</div>
				<Link href="/dashboard/integrations" className="text-xs text-primary hover:underline">
					Manage actions
				</Link>
			</div>
		</TooltipProvider>
	);
};

const Composer: FC<ComposerProps> = ({ sessionState, sessionId, token }) => {
	const composerRuntime = useComposerRuntime();
	const { selectedModel, setSelectedModel, reasoningEffort, setReasoningEffort } =
		useDashboardStore();
	const createFollowUp = useCreateFollowUp();

	const composerMode = deriveComposerMode(sessionState);
	const label = COMPOSER_LABELS[composerMode];
	const placeholder = COMPOSER_PLACEHOLDERS[composerMode];

	const handleFollowUpSubmit = useCallback(
		(text: string) => {
			if (!sessionState) return;

			if (composerMode === "completed") {
				createFollowUp.mutate({
					sourceSessionId: sessionState.sessionId,
					mode: "continuation",
					initialPrompt: text,
				});
			} else if (composerMode === "failed") {
				createFollowUp.mutate({
					sourceSessionId: sessionState.sessionId,
					mode: "rerun",
					initialPrompt: text,
				});
			}
		},
		[sessionState, composerMode, createFollowUp],
	);

	const isTerminal = composerMode === "completed" || composerMode === "failed";

	const handleTerminalSend = () => {
		const text = composerRuntime.getState().text.trim();
		if (!text) return;

		if (isTerminal && text) {
			handleFollowUpSubmit(text);
			composerRuntime.setText("");
			return;
		}
	};

	const hasContent = useComposer((s) => !!s.text.trim());

	return (
		<ComposerPrimitive.Root className="max-w-2xl mx-auto w-full">
			{label && <p className="text-xs text-muted-foreground px-5 pb-1.5">{label}</p>}
			<EnabledActionsStrip sessionId={sessionId} token={token} />

			<div className="flex flex-col rounded-3xl border border-border bg-muted/40 dark:bg-card">
				<ComposerPrimitive.Input
					placeholder={placeholder}
					className="flex-1 resize-none bg-transparent px-5 py-3.5 text-sm outline-none placeholder:text-muted-foreground"
					rows={1}
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							if (isTerminal) {
								e.preventDefault();
								handleTerminalSend();
							}
						}
					}}
				/>

				<div className="flex items-center justify-between px-3 pb-2">
					<div className="flex items-center gap-0.5">
						<ComposerActionsLeft
							selectedModel={selectedModel}
							reasoningEffort={reasoningEffort}
							onModelChange={setSelectedModel}
							onReasoningEffortChange={setReasoningEffort}
						/>
					</div>
					<div className="flex items-center gap-0.5">
						{sessionState?.workerId && (
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
								disabled
							>
								Send back to coworker
							</Button>
						)}
						<ComposerActionsRight
							hasContent={hasContent}
							isTerminal={isTerminal}
							onTerminalSend={handleTerminalSend}
						/>
					</div>
				</div>
			</div>
		</ComposerPrimitive.Root>
	);
};

const UserMessage: FC = () => (
	<MessagePrimitive.Root className="py-4 px-4">
		<div className="max-w-2xl mx-auto flex flex-col items-end gap-2">
			<MessagePrimitive.Content
				components={{
					Text: ({ text }) => (
						<div className="bg-muted rounded-2xl rounded-tr-md py-2.5 px-4 text-sm max-w-[85%]">
							<MarkdownContent text={text} variant="user" />
						</div>
					),
					Image: ({ image }) => (
						<img
							src={image}
							alt="Attached image"
							className="max-w-[80%] max-h-64 object-contain rounded-xl border border-border"
						/>
					),
				}}
			/>
		</div>
	</MessagePrimitive.Root>
);

const AssistantMessage: FC = () => (
	<MessagePrimitive.Root className="py-4 px-4">
		<div className="max-w-2xl mx-auto min-w-0 text-sm">
			<MessagePrimitive.Content
				components={{
					Text: ({ text }) => <MarkdownContent text={text} variant="assistant" />,
					tools: { Fallback: ToolFallback },
				}}
			/>
		</div>
	</MessagePrimitive.Root>
);

const ToolFallback: FC<{
	toolName: string;
	args: unknown;
	result?: unknown;
	status?: { type: string };
}> = ({ toolName, result, status }) => {
	const [expanded, setExpanded] = useState(false);
	const hasResult = result !== undefined;
	const resultString = hasResult
		? typeof result === "string"
			? result
			: JSON.stringify(result, null, 2)
		: null;

	return (
		<ProliferateToolCard
			label={toolName}
			status={
				status?.type === "running" ? "running" : status?.type === "error" ? "error" : "success"
			}
			errorMessage={typeof result === "string" && result.startsWith("Error") ? result : undefined}
		>
			<Button
				type="button"
				variant="ghost"
				onClick={() => hasResult && setExpanded(!expanded)}
				className="h-auto gap-1 p-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
				disabled={!hasResult}
			>
				{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				<span>{expanded ? "Hide details" : "Show details"}</span>
			</Button>
			{expanded && resultString && (
				<pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-border/40 bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
					{resultString.slice(0, 3000)}
				</pre>
			)}
		</ProliferateToolCard>
	);
};
