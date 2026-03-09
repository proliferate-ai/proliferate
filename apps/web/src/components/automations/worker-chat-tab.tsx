"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useWsToken } from "@/hooks/sessions/use-ws-token";
import { GATEWAY_URL } from "@/lib/infra/gateway";
import { type SyncWebSocket, createSyncClient } from "@proliferate/gateway-clients";
import type { Message, ServerMessage } from "@proliferate/shared";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface WorkerChatTabProps {
	managerSessionId: string;
	workerStatus: string;
}

export function WorkerChatTab({ managerSessionId, workerStatus }: WorkerChatTabProps) {
	const { token, isLoading: tokenLoading } = useWsToken();
	const [messages, setMessages] = useState<Message[]>([]);
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
	// Note: eagerStart requires service auth and will fail with a user token.
	// The session still wakes on WebSocket connect, so this is a best-effort
	// optimization that is silently ignored if it errors.
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
						setMessages(data.payload.messages ?? []);
						break;
					}
					case "message": {
						const msg = data.payload as Message;
						setMessages((prev) => {
							const idx = prev.findIndex((m) => m.id === msg.id);
							if (idx >= 0) {
								const updated = [...prev];
								updated[idx] = msg;
								return updated;
							}
							return [...prev, msg];
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
							if (idx >= 0) {
								const updated = [...prev];
								updated[idx] = {
									...updated[idx],
									content: updated[idx].content + tokenText,
									parts: [{ type: "text", text: updated[idx].content + tokenText }],
								};
								return updated;
							}
							return prev;
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
						<MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-3" />
						<p className="text-sm text-muted-foreground">
							{isConnected ? "No messages yet" : "Connecting..."}
						</p>
						<p className="text-xs text-muted-foreground/60 mt-1">
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
								? "Coworker is paused — resume to send messages"
								: "Send a message to this coworker..."
						}
						disabled={isPaused || !isConnected}
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

function ChatBubble({ message }: { message: Message }) {
	const isUser = message.role === "user";
	const content = message.content || "";
	const source = message.source as string | undefined;
	const isJob = source === "job";

	return (
		<div className="flex gap-3">
			<div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-muted">
				<span className="text-[10px] font-bold text-muted-foreground">
					{isUser ? (isJob ? "J" : "U") : "A"}
				</span>
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 mb-0.5">
					<span className="text-xs font-medium text-foreground">
						{isUser ? (isJob ? "Job" : "You") : "Agent"}
					</span>
					{message.createdAt && (
						<span className="text-[10px] text-muted-foreground">
							{new Date(message.createdAt).toLocaleTimeString()}
						</span>
					)}
				</div>
				<p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{content}</p>
			</div>
		</div>
	);
}
