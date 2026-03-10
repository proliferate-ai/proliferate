"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ExternalLink, Loader2, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrbPicker, PALETTE_PREVIEW_NAMES } from "./orb-picker";
import { WorkerOrb } from "./worker-card";

interface WorkerDetailHeaderProps {
	worker: {
		name: string;
		description: string | null;
		systemPrompt: string | null;
		status: string;
		managerSessionId: string;
	};
	onPause: () => void;
	onResume: () => void;
	onUpdateDescription?: (description: string) => void;
	isPausing: boolean;
	isResuming: boolean;
}

export function WorkerDetailHeader({
	worker,
	onPause,
	onResume,
	onUpdateDescription,
	isPausing,
	isResuming,
}: WorkerDetailHeaderProps) {
	const status = worker.status as "active" | "automations_paused" | "degraded" | "failed";
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(worker.description ?? "");
	const [selectedOrbIndex, setSelectedOrbIndex] = useState<number | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Sync edit value when worker data changes externally
	useEffect(() => {
		if (!isEditing) {
			setEditValue(worker.description ?? "");
		}
	}, [worker.description, isEditing]);

	// Focus input when entering edit mode
	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isEditing]);

	const handleSave = useCallback(() => {
		setIsEditing(false);
		const trimmed = editValue.trim();
		if (trimmed !== (worker.description ?? "") && onUpdateDescription) {
			onUpdateDescription(trimmed);
		}
	}, [editValue, worker.description, onUpdateDescription]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				handleSave();
			}
			if (e.key === "Escape") {
				setIsEditing(false);
				setEditValue(worker.description ?? "");
			}
		},
		[handleSave, worker.description],
	);

	const orbName = selectedOrbIndex != null ? PALETTE_PREVIEW_NAMES[selectedOrbIndex] : worker.name;

	return (
		<div className="flex items-center gap-4 mb-5">
			<OrbPicker selectedIndex={selectedOrbIndex} onSelect={setSelectedOrbIndex}>
				<button
					type="button"
					className="rounded-xl cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<WorkerOrb name={orbName} size={44} />
				</button>
			</OrbPicker>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<h1 className="text-base font-semibold text-foreground truncate">{worker.name}</h1>
					<StatusDot
						status={
							status === "active" ? "active" : status === "automations_paused" ? "paused" : "error"
						}
						size="sm"
					/>
				</div>
				{isEditing ? (
					<Input
						ref={inputRef}
						value={editValue}
						onChange={(e) => setEditValue(e.target.value)}
						onBlur={handleSave}
						onKeyDown={handleKeyDown}
						placeholder="Add a description..."
						className="h-6 text-xs mt-0.5 px-1 py-0 border-border/50"
					/>
				) : (
					<Button
						variant="ghost"
						onClick={() => onUpdateDescription && setIsEditing(true)}
						className={`h-auto p-0 font-normal text-xs mt-0.5 truncate text-left max-w-full block hover:bg-transparent ${
							worker.description
								? "text-muted-foreground hover:text-foreground"
								: "text-muted-foreground/50 italic hover:text-muted-foreground"
						} transition-colors ${onUpdateDescription ? "cursor-text" : "cursor-default"}`}
					>
						{worker.description || "No description"}
					</Button>
				)}
			</div>
			<TooltipProvider delayDuration={300}>
				<div className="flex items-center gap-1 shrink-0">
					{status === "active" && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									size="icon"
									variant="ghost"
									className="h-8 w-8"
									onClick={onPause}
									disabled={isPausing}
								>
									{isPausing ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<Pause className="h-4 w-4" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>Pause Automations</TooltipContent>
						</Tooltip>
					)}
					{status === "automations_paused" && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									size="icon"
									variant="ghost"
									className="h-8 w-8"
									onClick={onResume}
									disabled={isResuming}
								>
									{isResuming ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<Play className="h-4 w-4" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>Resume Automations</TooltipContent>
						</Tooltip>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button size="icon" variant="ghost" className="h-8 w-8" asChild>
								<Link href={`/workspace/${worker.managerSessionId}`}>
									<ExternalLink className="h-4 w-4" />
								</Link>
							</Button>
						</TooltipTrigger>
						<TooltipContent>Visit session</TooltipContent>
					</Tooltip>
				</div>
			</TooltipProvider>
		</div>
	);
}
