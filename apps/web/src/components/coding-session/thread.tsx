"use client";

import { ModelSelector } from "@/components/automations/model-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import {
	ComposerPrimitive,
	MessagePrimitive,
	ThreadPrimitive,
	useComposerRuntime,
	useThreadRuntime,
} from "@assistant-ui/react";
import type { ModelId } from "@proliferate/shared";
import {
	ArrowUp,
	Camera,
	ChevronDown,
	ChevronRight,
	Loader2,
	Mic,
	Paperclip,
	Square,
	X,
} from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import { allToolUIs } from "./tool-ui";

// Shared markdown components for consistent rendering
interface MarkdownContentProps {
	text: string;
	variant?: "user" | "assistant";
}

const MarkdownContent: FC<MarkdownContentProps> = ({ text, variant = "assistant" }) => {
	const isUser = variant === "user";

	return (
		<Markdown
			components={{
				p: ({ children }) => (
					<p className={cn("leading-relaxed", isUser ? "mb-2 last:mb-0" : "mb-3 last:mb-0")}>
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
					const bgClass = isUser ? "bg-background/50" : "bg-muted/50";
					return isBlock ? (
						<pre
							className={cn(
								bgClass,
								"rounded-md overflow-x-auto",
								isUser ? "p-2 my-2" : "p-3 my-3",
							)}
						>
							<code className="text-xs font-mono">{children}</code>
						</pre>
					) : (
						<code
							className={cn(
								bgClass,
								"rounded text-xs font-mono",
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

// Attachment preview with remove button
interface AttachmentPreviewProps {
	preview: string;
	index: number;
	onRemove: (index: number) => void;
}

const AttachmentPreview: FC<AttachmentPreviewProps> = ({ preview, index, onRemove }) => (
	<div className="relative group">
		<img
			src={preview}
			alt={`Attachment ${index + 1}`}
			className="h-16 w-16 object-cover rounded-lg border border-border"
		/>
		<Button
			type="button"
			variant="destructive"
			size="icon"
			onClick={() => onRemove(index)}
			className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
		>
			<X className="h-3 w-3" />
		</Button>
	</div>
);

// Context selectors (model selector) - left side of toolbar
interface ComposerActionsLeftProps {
	selectedModel: ModelId;
	onModelChange: (modelId: ModelId) => void;
}

const ComposerActionsLeft: FC<ComposerActionsLeftProps> = ({ selectedModel, onModelChange }) => (
	<div className="flex items-center gap-1">
		<ModelSelector modelId={selectedModel} onChange={onModelChange} variant="ghost" />
	</div>
);

// Action buttons (attach, mic, send/cancel) - right side of toolbar
interface ComposerActionsRightProps {
	hasAttachments: boolean;
	hasContent: boolean;
	onSendWithAttachments: () => void;
	onAttachClick: () => void;
	onToggleRecording: () => void;
	listening: boolean;
	browserSupportsSpeechRecognition: boolean;
}

const ComposerActionsRight: FC<ComposerActionsRightProps> = ({
	hasAttachments,
	hasContent,
	onSendWithAttachments,
	onAttachClick,
	onToggleRecording,
	listening,
	browserSupportsSpeechRecognition,
}) => (
	<div className="flex items-center gap-1">
		<Button
			variant="ghost"
			size="icon"
			className="h-8 w-8 text-muted-foreground hover:text-foreground"
			onClick={onAttachClick}
		>
			<Paperclip className="h-4 w-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			className={cn(
				"h-8 w-8",
				listening
					? "text-red-500 hover:text-red-600"
					: "text-muted-foreground hover:text-foreground",
			)}
			onClick={onToggleRecording}
			disabled={!browserSupportsSpeechRecognition}
		>
			<Mic className={cn("h-4 w-4", listening && "animate-pulse")} />
		</Button>
		<ThreadPrimitive.If running={false}>
			{hasAttachments ? (
				<Button
					size="icon"
					className="h-8 w-8 rounded-full"
					onClick={onSendWithAttachments}
					disabled={!hasContent}
				>
					<ArrowUp className="h-4 w-4" />
				</Button>
			) : (
				<ComposerPrimitive.Send asChild>
					<Button size="icon" className="h-8 w-8 rounded-full">
						<ArrowUp className="h-4 w-4" />
					</Button>
				</ComposerPrimitive.Send>
			)}
		</ThreadPrimitive.If>
		<ThreadPrimitive.If running>
			<ComposerPrimitive.Cancel asChild>
				<Button
					size="icon"
					className="h-8 w-8 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
				>
					<Square className="h-3 w-3 fill-current" />
				</Button>
			</ComposerPrimitive.Cancel>
		</ThreadPrimitive.If>
	</div>
);

interface ThreadProps {
	title?: string;
	description?: string;
	onSnapshot?: () => void;
	isSnapshotting?: boolean;
	showSnapshot?: boolean;
}

export const Thread: FC<ThreadProps> = ({
	title = "What would you like to build?",
	description = "Describe what you want to create, fix, or explore in your codebase.",
	onSnapshot,
	isSnapshotting,
	showSnapshot = false,
}) => {
	return (
		<ThreadPrimitive.Root className="flex h-full flex-col">
			{/* Scrollable message area */}
			<ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
				<ThreadPrimitive.Empty>
					<div className="flex h-full flex-col items-center justify-center p-8 text-center">
						<Text variant="h4" className="text-lg tracking-tight">
							{title}
						</Text>
						<Text variant="body" color="muted" className="mt-2 text-sm max-w-md">
							{description}
						</Text>
					</div>
				</ThreadPrimitive.Empty>

				<ThreadPrimitive.Messages
					components={{
						UserMessage,
						AssistantMessage,
					}}
				/>

				{/* Blinking cursor while waiting for response */}
				<ThreadPrimitive.If running>
					<div className="py-3 px-3">
						<div className="max-w-2xl mx-auto">
							<BlinkingCursor />
						</div>
					</div>
				</ThreadPrimitive.If>
			</ThreadPrimitive.Viewport>

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
				<Composer />
			</div>

			{allToolUIs.map(({ id, Component }) => (
				<Component key={id} />
			))}
		</ThreadPrimitive.Root>
	);
};

const Composer: FC = () => {
	const [attachments, setAttachments] = useState<{ file: File; preview: string }[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const threadRuntime = useThreadRuntime();
	const composerRuntime = useComposerRuntime();
	const { selectedModel, setSelectedModel } = useDashboardStore();

	const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition } =
		useSpeechRecognition();

	// Append transcript to composer when speech recognition completes
	useEffect(() => {
		if (!listening && transcript) {
			const currentText = composerRuntime.getState().text;
			composerRuntime.setText(currentText + (currentText ? " " : "") + transcript);
			resetTranscript();
		}
	}, [listening, transcript, resetTranscript, composerRuntime]);

	const handleAttachClick = () => fileInputRef.current?.click();

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file?.type.startsWith("image/")) {
			const reader = new FileReader();
			reader.onloadend = () => {
				setAttachments((prev) => [...prev, { file, preview: reader.result as string }]);
			};
			reader.readAsDataURL(file);
		}
		e.target.value = "";
	};

	const removeAttachment = (index: number) => {
		setAttachments((prev) => prev.filter((_, i) => i !== index));
	};

	const toggleRecording = () => {
		if (listening) {
			SpeechRecognition.stopListening();
		} else {
			SpeechRecognition.startListening({ continuous: true });
		}
	};

	const handleSendWithAttachments = () => {
		const text = composerRuntime.getState().text.trim();
		if (!text && attachments.length === 0) return;

		const content: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [];
		if (text) content.push({ type: "text", text });
		for (const attachment of attachments) {
			content.push({ type: "image", image: attachment.preview });
		}

		threadRuntime.append({ role: "user", content });
		composerRuntime.setText("");
		setAttachments([]);
	};

	const hasContent = composerRuntime.getState().text.trim() || attachments.length > 0;

	return (
		<ComposerPrimitive.Root className="max-w-2xl mx-auto w-full">
			<Input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				onChange={handleFileChange}
				className="hidden"
			/>

			<div className="flex flex-col rounded-2xl border bg-muted/40 dark:bg-chat-input">
				{attachments.length > 0 && (
					<div className="flex gap-2 p-3 pb-0 flex-wrap">
						{attachments.map((attachment, index) => (
							<AttachmentPreview
								key={attachment.preview}
								preview={attachment.preview}
								index={index}
								onRemove={removeAttachment}
							/>
						))}
					</div>
				)}

				<ComposerPrimitive.Input
					placeholder="Message..."
					className="flex-1 resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
					rows={1}
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && attachments.length > 0) {
							e.preventDefault();
							handleSendWithAttachments();
						}
					}}
				/>

				<div className="flex items-center justify-between px-2 py-1.5">
					<ComposerActionsLeft selectedModel={selectedModel} onModelChange={setSelectedModel} />
					<ComposerActionsRight
						hasAttachments={attachments.length > 0}
						hasContent={!!hasContent}
						onSendWithAttachments={handleSendWithAttachments}
						onAttachClick={handleAttachClick}
						onToggleRecording={toggleRecording}
						listening={listening}
						browserSupportsSpeechRecognition={browserSupportsSpeechRecognition}
					/>
				</div>
			</div>
		</ComposerPrimitive.Root>
	);
};

const UserMessage: FC = () => (
	<MessagePrimitive.Root className="mt-3 mb-1 px-3">
		<div className="max-w-2xl mx-auto flex flex-col items-end gap-2">
			<MessagePrimitive.Content
				components={{
					Text: ({ text }) => (
						<div className="bg-muted inline-flex rounded-xl py-1.5 pl-3 pr-3.5 text-sm max-w-[85%]">
							<MarkdownContent text={text} variant="user" />
						</div>
					),
					Image: ({ image }) => (
						<img
							src={image}
							alt="Attached image"
							className="max-w-[80%] max-h-64 object-contain rounded-lg border border-border"
						/>
					),
				}}
			/>
		</div>
	</MessagePrimitive.Root>
);

const BlinkingCursor = () => <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;

const AssistantMessage: FC = () => (
	<MessagePrimitive.Root className="pb-3 px-3">
		<div className="max-w-2xl mx-auto">
			<div className="text-sm">
				<MessagePrimitive.Content
					components={{
						Text: ({ text }) => <MarkdownContent text={text} variant="assistant" />,
						tools: { Fallback: ToolFallback },
					}}
				/>
			</div>
		</div>
	</MessagePrimitive.Root>
);

const ToolFallback: FC<{ toolName: string; args: unknown; result?: unknown }> = ({
	toolName,
	result,
}) => {
	const [expanded, setExpanded] = useState(false);
	const hasResult = result !== undefined;
	const resultString = hasResult
		? typeof result === "string"
			? result
			: JSON.stringify(result, null, 2)
		: null;

	return (
		<div className="my-0.5 ml-4">
			<button
				type="button"
				onClick={() => hasResult && setExpanded(!expanded)}
				className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
				disabled={!hasResult}
			>
				{hasResult ? (
					expanded ? (
						<ChevronDown className="h-3 w-3" />
					) : (
						<ChevronRight className="h-3 w-3" />
					)
				) : (
					<Loader2 className="h-3 w-3 animate-spin" />
				)}
				<code className="text-xs">{toolName}</code>
			</button>
			{expanded && resultString && (
				<pre className="ml-4 mt-1 max-h-40 overflow-auto rounded border border-border/40 bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
					{resultString.slice(0, 3000)}
				</pre>
			)}
		</div>
	);
};
