"use client";

import { ModelSelector } from "@/components/automations/model-selector";
import { WorkerOrb } from "@/components/automations/worker-card";
import { CapabilitiesBadges } from "@/components/dashboard/capabilities-badges";
import { Button } from "@/components/ui/button";
import { OpenCodeIcon } from "@/components/ui/icons";
import { LoadingDots } from "@/components/ui/loading-dots";
import { RoundIconActionButton } from "@/components/ui/round-icon-action-button";
import { COMPOSER_LABELS, COMPOSER_PLACEHOLDERS, type ComposerMode } from "@/config/coding-session";
import { useCreateFollowUp } from "@/hooks/sessions/use-follow-up";
import { useSessionIntegrationSummaries } from "@/hooks/sessions/use-session-integrations";
import { cn } from "@/lib/display/utils";
import { parseAssistantContentSegments } from "@/lib/sessions/assistant-content";
import { useDashboardStore } from "@/stores/dashboard";
import {
	ComposerPrimitive,
	MessagePrimitive,
	ThreadPrimitive,
	useComposer,
	useComposerRuntime,
	useMessage,
} from "@assistant-ui/react";
import type { ActionApprovalRequestMessage } from "@proliferate/shared";
import type { ModelId } from "@proliferate/shared";
import type { Session } from "@proliferate/shared/contracts/sessions";
import type { OverallWorkState } from "@proliferate/shared/sessions";
import { ArrowUp, Camera, ChevronDown, ChevronRight, Loader2, Square } from "lucide-react";
import type { FC } from "react";
import { useCallback, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { InboxTray } from "./inbox-tray";
import { allToolUIs } from "./tool-ui/all-tool-uis";
import { ToolCallBlock, type ToolCallPart as ToolCallPartType } from "./tool-ui/tool-call-renderer";

// Shared markdown components for consistent rendering
interface MarkdownContentProps {
	text: string;
	variant?: "user" | "assistant";
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

export const MarkdownContent: FC<MarkdownContentProps> = ({ text, variant = "assistant" }) => {
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
							// biome-ignore lint/suspicious/noArrayIndexKey: ordered message segments, stable position
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
			remarkPlugins={[remarkGfm]}
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
				table: ({ children }) => (
					<div className={cn("overflow-x-auto", isUser ? "my-2" : "my-3")}>
						<table className="w-full border-collapse text-sm">{children}</table>
					</div>
				),
				thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
				tbody: ({ children }) => <tbody>{children}</tbody>,
				tr: ({ children }) => <tr className="border-b border-border/50">{children}</tr>,
				th: ({ children }) => (
					<th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">{children}</th>
				),
				td: ({ children }) => <td className="px-3 py-1.5">{children}</td>,
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
		<ModelSelector
			modelId={selectedModel}
			onChange={onModelChange}
			variant="ghost"
			reasoningEffort={reasoningEffort}
			onReasoningChange={onReasoningEffortChange}
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
	automationName?: string | null;
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
							{sessionState?.automationName ? (
								<WorkerOrb name={sessionState.automationName} size={20} />
							) : (
								<OpenCodeIcon className="h-5 w-5" />
							)}
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

interface ComposerProps {
	sessionState?: SessionStateForComposer;
	sessionId?: string;
	token?: string | null;
}

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
	const integrationSummaries = useSessionIntegrationSummaries(sessionId, token);

	return (
		<ComposerPrimitive.Root className="max-w-2xl mx-auto w-full">
			{label && <p className="text-xs text-muted-foreground px-5 pb-1.5">{label}</p>}

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
					<div className="flex items-center gap-2">
						<CapabilitiesBadges
							mode={sessionState?.workerId ? "coworker" : "opencode"}
							workerId={sessionState?.workerId ?? undefined}
							integrationSummaries={integrationSummaries}
						/>
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

interface ContentPart {
	type: string;
	text?: string;
	toolName?: string;
	toolCallId?: string;
	args?: Record<string, unknown>;
	result?: unknown;
	status?: { type: string };
}

const AssistantMessage: FC = () => {
	const message = useMessage();
	const content = (message.content ?? []) as ContentPart[];
	const isRunning = message.status?.type === "running";
	const hasTextContent = content.some((p) => p.type === "text" && p.text?.trim());

	const groups: Array<
		{ type: "text"; part: ContentPart } | { type: "tools"; parts: ToolCallPartType[] }
	> = [];
	for (const part of content) {
		if (part.type === "tool-call") {
			const toolPart: ToolCallPartType = {
				toolName: part.toolName ?? "tool",
				toolCallId: part.toolCallId,
				args: part.args ?? {},
				result: part.result,
				status: part.status,
			};
			const lastGroup = groups[groups.length - 1];
			if (lastGroup?.type === "tools") {
				lastGroup.parts.push(toolPart);
			} else {
				groups.push({ type: "tools", parts: [toolPart] });
			}
		} else {
			groups.push({ type: "text", part });
		}
	}

	return (
		<MessagePrimitive.Root className="py-4 px-4">
			<div className="max-w-2xl mx-auto min-w-0 text-sm">
				{groups.map((group, i) => {
					if (group.type === "text") {
						const text = group.part.text?.trim();
						if (!text) return null;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: ordered content groups, stable position
							<div key={`text-${i}`} className="animate-in fade-in duration-300">
								<MarkdownContent text={text} variant="assistant" />
							</div>
						);
					}

					// biome-ignore lint/suspicious/noArrayIndexKey: ordered content groups, stable position
					return <ToolCallBlock key={`tools-${i}`} tools={group.parts} />;
				})}

				{isRunning && !hasTextContent && content.length === 0 && (
					<div className="py-2">
						<LoadingDots size="sm" className="text-muted-foreground" />
					</div>
				)}
			</div>
		</MessagePrimitive.Root>
	);
};
