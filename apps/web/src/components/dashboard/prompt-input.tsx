"use client";

import { ModelSelector } from "@/components/automations/model-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { ArrowUp, Mic, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

interface PromptInputProps {
	onSubmit: (prompt: string) => void;
	disabled?: boolean;
	isLoading?: boolean;
}

export function PromptInput({ onSubmit, disabled, isLoading }: PromptInputProps) {
	const [prompt, setPrompt] = useState("");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [attachments, setAttachments] = useState<{ file: File; preview: string }[]>([]);

	const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition } =
		useSpeechRecognition();

	const { selectedRepoId, selectedSnapshotId, selectedModel, setSelectedModel } =
		useDashboardStore();

	// Append transcript to prompt when speech recognition completes
	useEffect(() => {
		if (!listening && transcript) {
			setPrompt((prev) => prev + (prev ? " " : "") + transcript);
			resetTranscript();
		}
	}, [listening, transcript, resetTranscript]);

	const canSubmit =
		!disabled && !isLoading && prompt.trim() && selectedRepoId && selectedSnapshotId;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (canSubmit) {
			onSubmit(prompt.trim());
			// Don't clear prompt - keep it visible during loading
			// It will be cleared when session becomes active
		}
	};

	const handleAttachClick = () => {
		fileInputRef.current?.click();
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file?.type.startsWith("image/")) {
			const reader = new FileReader();
			reader.onloadend = () => {
				setAttachments((prev) => [...prev, { file, preview: reader.result as string }]);
			};
			reader.readAsDataURL(file);
		}
		// Reset input so same file can be selected again
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

	return (
		<form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
			{/* Hidden file input */}
			<Input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				onChange={handleFileChange}
				className="hidden"
			/>

			<div
				className={cn(
					"rounded-2xl border border-border bg-card dark:bg-chat-input shadow-sm transition-all overflow-hidden",
					"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:border-transparent",
				)}
			>
				{/* Attachment previews */}
				{attachments.length > 0 && (
					<div className="flex gap-2 p-3 pb-0">
						{attachments.map((attachment, index) => (
							<div key={attachment.preview} className="relative group">
								<img
									src={attachment.preview}
									alt={`Attachment ${index + 1}`}
									className="h-16 w-16 object-cover rounded-lg border border-border"
								/>
								<Button
									type="button"
									variant="ghost"
									onClick={() => removeAttachment(index)}
									className="absolute -top-1.5 -right-1.5 h-5 w-5 p-0 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
								>
									×
								</Button>
							</div>
						))}
					</div>
				)}

				{/* Text input area */}
				<Textarea
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					placeholder="Ask or build anything"
					className="w-full min-h-[120px] p-4 pb-2 bg-transparent resize-none focus:outline-none text-[15px] leading-relaxed border-0 focus-visible:ring-0"
					disabled={disabled || isLoading}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							handleSubmit(e);
						}
					}}
				/>

				{/* Bottom toolbar */}
				<div className="flex items-center justify-between px-3 py-2">
					{/* Left side - Context selectors */}
					<div className="flex items-center gap-1">
						<ModelSelector
							modelId={selectedModel}
							onChange={setSelectedModel}
							disabled={isLoading}
							variant="ghost"
						/>
					</div>

					{/* Right side - Actions & Submit */}
					<div className="flex items-center gap-1">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-muted-foreground hover:text-foreground"
							onClick={handleAttachClick}
							disabled={isLoading}
						>
							<Paperclip className="h-4 w-4" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className={cn(
								"h-8 w-8",
								listening
									? "text-red-500 hover:text-red-600"
									: "text-muted-foreground hover:text-foreground",
							)}
							onClick={toggleRecording}
							disabled={isLoading || !browserSupportsSpeechRecognition}
						>
							<Mic className={cn("h-4 w-4", listening && "animate-pulse")} />
						</Button>
						<Button
							type="submit"
							size="icon"
							disabled={!canSubmit}
							className={cn(
								"h-8 w-8 rounded-full transition-all",
								canSubmit ? "bg-primary hover:bg-primary/90" : "bg-muted text-muted-foreground",
							)}
						>
							<ArrowUp className="h-4 w-4" />
						</Button>
					</div>
				</div>
			</div>
		</form>
	);
}
