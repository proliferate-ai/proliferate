"use client";

import { WorkerOrb } from "@/components/automations/worker-card";
import { MarkdownContent } from "@/components/coding-session/thread";
import { Button } from "@/components/ui/button";
import { OpenCodeIcon } from "@/components/ui/icons";
import { Textarea } from "@/components/ui/textarea";
import { useWsToken } from "@/hooks/sessions/use-ws-token";
import { GATEWAY_URL } from "@/lib/infra/gateway";
import { type SyncWebSocket, createSyncClient } from "@proliferate/gateway-clients";
import type { Message, ServerMessage } from "@proliferate/shared";
import { CheckCircle, Clock, ExternalLink, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface ToolPart {
	type: "tool";
	toolCallId: string;
	toolName: string;
	args?: unknown;
	result?: string;
	isComplete: boolean;
}

interface ChatMessage extends Omit<Message, "parts"> {
	parts?: Array<{ type: "text"; text: string } | ToolPart>;
}

interface WorkerChatTabProps {
	managerSessionId: string;
	workerStatus: string;
	workerName: string;
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

export function WorkerChatTab({ managerSessionId, workerStatus, workerName }: WorkerChatTabProps) {
	const { token, isLoading: tokenLoading } = useWsToken();
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [inputContent, setInputContent] = useState("");
	const [isConnected, setIsConnected] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const wsRef = useRef<SyncWebSocket | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom when messages change
	// biome-ignore lint/correctness/useExhaustiveDependencies: messages is an intentional trigger for scroll
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages]);

	// Auto-wake: eager-start the manager session on mount.
	useEffect(() => {
		if (!token || !managerSessionId) return;
		const client = createSyncClient({
			baseUrl: GATEWAY_URL,
			auth: { type: "token", token },
			source: "web",
		});
		// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional fire-and-forget
		client.eagerStart(managerSessionId).catch(() => {});
	}, [token, managerSessionId]);

	// WebSocket connection
	useEffect(() => {
		if (!token || !managerSessionId) return;

		const client = createSyncClient({
			baseUrl: GATEWAY_URL,
			auth: { type: "token", token },
			source: "web",
		});

		const ws = client.connect(managerSessionId, {
			onOpen: () => {
				setIsConnected(true);
				setError(null);
			},
			onClose: () => {
				setIsConnected(false);
				setIsStreaming(false);
			},
			onReconnectFailed: () => {
				setError("Connection lost");
			},
			onEvent: (data: ServerMessage) => {
				switch (data.type) {
					case "init": {
						setMessages((data.payload.messages ?? []) as ChatMessage[]);
						break;
					}
					case "message": {
						const msg = data.payload as ChatMessage;
						setMessages((prev) => {
							const idx = prev.findIndex((m) => m.id === msg.id);
							if (idx >= 0) {
								const updated = [...prev];
								updated[idx] = { ...updated[idx], ...msg, parts: updated[idx].parts };
								return updated;
							}
							return [...prev, { ...msg, parts: msg.parts || [] }];
						});
						if (msg.role === "assistant" && !msg.isComplete) {
							setIsStreaming(true);
						}
						break;
					}
					case "token": {
						const { messageId, token: tokenText } = data.payload as {
							messageId: string;
							token: string;
						};
						setMessages((prev) => {
							const idx = prev.findIndex((m) => m.id === messageId);
							if (idx < 0) return prev;
							const updated = [...prev];
							const msg = updated[idx];
							const newContent = (msg.content ?? "") + tokenText;
							const parts = [...(msg.parts || [])];
							const lastPart = parts[parts.length - 1];
							if (lastPart?.type === "text") {
								parts[parts.length - 1] = { type: "text", text: lastPart.text + tokenText };
							} else {
								parts.push({ type: "text", text: tokenText });
							}
							updated[idx] = { ...msg, content: newContent, parts };
							return updated;
						});
						break;
					}
					case "tool_start": {
						const payload = data.payload as {
							messageId?: string;
							toolCallId: string;
							tool: string;
							args?: unknown;
						};
						setMessages((prev) => {
							let idx = payload.messageId ? prev.findIndex((m) => m.id === payload.messageId) : -1;
							if (idx < 0) {
								for (let i = prev.length - 1; i >= 0; i--) {
									if (prev[i].role === "assistant") {
										idx = i;
										break;
									}
								}
							}
							if (idx < 0) return prev;
							const updated = [...prev];
							const msg = updated[idx];
							const parts = [...(msg.parts || [])];
							const existingIdx = parts.findIndex(
								(p) => p.type === "tool" && p.toolCallId === payload.toolCallId,
							);
							if (existingIdx >= 0 && payload.args && parts[existingIdx].type === "tool") {
								parts[existingIdx] = { ...parts[existingIdx], args: payload.args };
							} else if (existingIdx < 0) {
								parts.push({
									type: "tool",
									toolCallId: payload.toolCallId,
									toolName: payload.tool,
									args: payload.args,
									isComplete: false,
								});
							}
							updated[idx] = { ...msg, parts };
							return updated;
						});
						break;
					}
					case "tool_end": {
						const payload = data.payload as {
							toolCallId: string;
							tool: string;
							result?: unknown;
						};
						setMessages((prev) => {
							const updated = prev.map((msg) => {
								if (msg.role !== "assistant" || !msg.parts) return msg;
								const parts = msg.parts.map((p) => {
									if (p.type === "tool" && p.toolCallId === payload.toolCallId) {
										return {
											...p,
											result:
												typeof payload.result === "string"
													? payload.result
													: JSON.stringify(payload.result),
											isComplete: true,
										};
									}
									return p;
								});
								return { ...msg, parts };
							});
							return updated;
						});
						break;
					}
					case "message_complete": {
						const { messageId } = data.payload as { messageId: string };
						setMessages((prev) => {
							const idx = prev.findIndex((m) => m.id === messageId);
							if (idx >= 0) {
								const updated = [...prev];
								updated[idx] = { ...updated[idx], isComplete: true };
								return updated;
							}
							return prev;
						});
						setIsStreaming(false);
						break;
					}
					case "message_cancelled": {
						setIsStreaming(false);
						break;
					}
					case "error": {
						setIsStreaming(false);
						break;
					}
				}
			},
		});

		wsRef.current = ws;

		return () => {
			ws.close();
			wsRef.current = null;
		};
	}, [token, managerSessionId]);

	const handleSend = useCallback(() => {
		const content = inputContent.trim();
		if (!content || !wsRef.current?.isConnected) return;
		wsRef.current.sendPrompt(content);
		setInputContent("");
	}, [inputContent]);

	if (tokenLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const isPaused = workerStatus === "automations_paused";

	return (
		<div className="flex flex-col gap-0 -mx-6 -mb-6" style={{ height: "calc(100vh - 240px)" }}>
			{/* Messages area */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full text-center">
						<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted mb-4">
							<WorkerOrb name={workerName} size={24} />
						</div>
						<p className="text-base font-semibold tracking-tight text-foreground">{workerName}</p>
						<p className="mt-1.5 text-sm text-muted-foreground max-w-xs">
							Send a message to start chatting with this coworker
						</p>
					</div>
				) : (
					<div className="space-y-4">
						{messages.map((msg) => (
							<ChatBubble key={msg.id} message={msg} />
						))}
						{isStreaming && (
							<div className="flex items-center gap-2 px-3">
								<Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
								<span className="text-xs text-muted-foreground">Thinking...</span>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Connection status */}
			{error && (
				<div className="shrink-0 px-6 py-1.5 bg-destructive/10 text-destructive text-xs text-center">
					{error}
				</div>
			)}

			{/* Composer */}
			<div className="shrink-0 border-t border-border bg-background px-6 py-3">
				<div className="rounded-lg border border-border overflow-hidden focus-within:border-foreground/30 transition-colors">
					<Textarea
						value={inputContent}
						onChange={(e) => setInputContent(e.target.value)}
						placeholder={
							isPaused
								? "Coworker is paused \u2014 resume to send messages"
								: "Send a message to this coworker..."
						}
						disabled={isPaused}
						className="w-full text-sm border-none resize-none px-4 py-3 bg-transparent rounded-none min-h-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
						style={{ minHeight: "52px", maxHeight: "120px" }}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								handleSend();
							}
						}}
					/>
					<div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/30">
						<p className="text-xs text-muted-foreground">Press Cmd+Enter to send</p>
						<Button
							size="sm"
							className="h-7 gap-1.5"
							onClick={handleSend}
							disabled={!inputContent.trim() || isPaused || !isConnected}
						>
							<Send className="h-3 w-3" />
							Send
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

// --------------------------------------------------------------------------
// Chat bubble with markdown rendering
// --------------------------------------------------------------------------

function ChatBubble({ message }: { message: ChatMessage }) {
	const isUser = message.role === "user";
	const source = message.source as string | undefined;
	const isJob = source === "job" || source === "automation";
	const parts = message.parts || [];
	const hasContent = parts.some((p) => p.type === "text" && p.text.trim());
	const hasTools = parts.some((p) => p.type === "tool");
	const variant = isUser ? "user" : "assistant";

	if (parts.length === 0 && message.content) {
		return (
			<BubbleShell role={isUser ? (isJob ? "job" : "user") : "agent"} createdAt={message.createdAt}>
				<div className="text-sm">
					<MarkdownContent text={message.content} variant={variant} />
				</div>
			</BubbleShell>
		);
	}

	return (
		<BubbleShell role={isUser ? (isJob ? "job" : "user") : "agent"} createdAt={message.createdAt}>
			{parts.map((part, i) => {
				if (part.type === "text" && part.text.trim()) {
					return (
						<div key={`text-${i}`} className="text-sm">
							<MarkdownContent text={part.text} variant={variant} />
						</div>
					);
				}
				if (part.type === "tool") {
					return <ToolCallCard key={part.toolCallId} tool={part} />;
				}
				return null;
			})}
			{!hasContent && !hasTools && message.content && (
				<div className="text-sm">
					<MarkdownContent text={message.content} variant={variant} />
				</div>
			)}
		</BubbleShell>
	);
}

function BubbleShell({
	role,
	createdAt,
	children,
}: { role: "user" | "agent" | "job"; createdAt?: number; children: React.ReactNode }) {
	const labels = { user: "You", agent: "Agent", job: "Scheduled Job" };
	const initials = { user: "U", agent: "A", job: "J" };

	return (
		<div className="flex gap-3">
			<div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-muted">
				{role === "job" ? (
					<Clock className="h-3 w-3 text-muted-foreground" />
				) : (
					<span className="text-[10px] font-bold text-muted-foreground">{initials[role]}</span>
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 mb-0.5">
					<span className="text-xs font-medium text-foreground">{labels[role]}</span>
					{createdAt && (
						<span className="text-[10px] text-muted-foreground">
							{new Date(createdAt).toLocaleTimeString()}
						</span>
					)}
				</div>
				<div className="flex flex-col gap-2">{children}</div>
			</div>
		</div>
	);
}

// --------------------------------------------------------------------------
// Tool call inline cards
// --------------------------------------------------------------------------

function ToolCallCard({ tool }: { tool: ToolPart }) {
	if (tool.toolName === "spawn_child_task") {
		return <SpawnChildCard tool={tool} />;
	}
	if (tool.toolName === "invoke_action") {
		return <ActionCard tool={tool} />;
	}
	return <GenericToolCard tool={tool} />;
}

function SpawnChildCard({ tool }: { tool: ToolPart }) {
	const args = tool.args as { title?: string; instructions?: string } | undefined;
	const parsed = parseToolResult(tool.result);
	const sessionId = parsed?.session_id as string | undefined;
	const title = args?.title || (parsed?.title as string | undefined) || "Child session";

	return (
		<div className="rounded-md border border-border bg-card px-3 py-2 flex items-center gap-3">
			<OpenCodeIcon className="h-4 w-4 shrink-0" />
			<div className="flex-1 min-w-0">
				<span className="text-xs font-medium text-foreground">{title}</span>
				{args?.instructions && (
					<p className="text-xs text-muted-foreground truncate">{args.instructions}</p>
				)}
			</div>
			<div className="flex items-center gap-2 shrink-0">
				<ToolStatusIcon isComplete={tool.isComplete} />
				{sessionId && (
					<Link
						href={`/workspace/${sessionId}`}
						className="text-xs text-primary hover:underline flex items-center gap-1"
					>
						Open
						<ExternalLink className="h-3 w-3" />
					</Link>
				)}
			</div>
		</div>
	);
}

function ActionCard({ tool }: { tool: ToolPart }) {
	const args = tool.args as { integration?: string; action?: string } | undefined;
	const integration = args?.integration || "action";
	const label = args?.action ? `${integration}.${args.action}` : integration;

	return (
		<div className="rounded-md border border-border bg-card px-3 py-2 flex items-center gap-3">
			<Clock className="h-4 w-4 text-muted-foreground shrink-0" />
			<span className="text-xs font-medium text-foreground flex-1 min-w-0 truncate">{label}</span>
			<ToolStatusIcon isComplete={tool.isComplete} />
		</div>
	);
}

function GenericToolCard({ tool }: { tool: ToolPart }) {
	return (
		<div className="rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 flex items-center gap-2">
			<span className="text-xs text-muted-foreground">{tool.toolName}</span>
			<ToolStatusIcon isComplete={tool.isComplete} />
		</div>
	);
}

function ToolStatusIcon({ isComplete }: { isComplete: boolean }) {
	if (isComplete) {
		return <CheckCircle className="h-3.5 w-3.5 text-success" />;
	}
	return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
}

function parseToolResult(raw: string | undefined): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
