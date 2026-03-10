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
	onUpdateName?: (name: string) => void;
	onUpdateDescription?: (description: string) => void;
	isPausing: boolean;
	isResuming: boolean;
}

export function WorkerDetailHeader({
	worker,
	onPause,
	onResume,
	onUpdateName,
	onUpdateDescription,
	isPausing,
	isResuming,
}: WorkerDetailHeaderProps) {
	const status = worker.status as "active" | "automations_paused" | "degraded" | "failed";
	const [isEditingDesc, setIsEditingDesc] = useState(false);
	const [descValue, setDescValue] = useState(worker.description ?? "");
	const [isEditingName, setIsEditingName] = useState(false);
	const [nameValue, setNameValue] = useState(worker.name);
	const [selectedOrbIndex, setSelectedOrbIndex] = useState<number | null>(null);
	const descInputRef = useRef<HTMLInputElement>(null);
	const nameInputRef = useRef<HTMLInputElement>(null);

	// Sync edit values when worker data changes externally
	useEffect(() => {
		if (!isEditingDesc) {
			setDescValue(worker.description ?? "");
		}
	}, [worker.description, isEditingDesc]);

	useEffect(() => {
		if (!isEditingName) {
			setNameValue(worker.name);
		}
	}, [worker.name, isEditingName]);

	// Focus input when entering edit mode
	useEffect(() => {
		if (isEditingDesc && descInputRef.current) {
			descInputRef.current.focus();
			descInputRef.current.select();
		}
	}, [isEditingDesc]);

	useEffect(() => {
		if (isEditingName && nameInputRef.current) {
			nameInputRef.current.focus();
			nameInputRef.current.select();
		}
	}, [isEditingName]);

	const handleSaveDesc = useCallback(() => {
		setIsEditingDesc(false);
		const trimmed = descValue.trim();
		if (trimmed !== (worker.description ?? "") && onUpdateDescription) {
			onUpdateDescription(trimmed);
		}
	}, [descValue, worker.description, onUpdateDescription]);

	const handleSaveName = useCallback(() => {
		setIsEditingName(false);
		const trimmed = nameValue.trim();
		if (trimmed && trimmed !== worker.name && onUpdateName) {
			onUpdateName(trimmed);
		} else {
			setNameValue(worker.name);
		}
	}, [nameValue, worker.name, onUpdateName]);

	const handleDescKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				handleSaveDesc();
			}
			if (e.key === "Escape") {
				setIsEditingDesc(false);
				setDescValue(worker.description ?? "");
			}
		},
		[handleSaveDesc, worker.description],
	);

	const handleNameKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				handleSaveName();
			}
			if (e.key === "Escape") {
				setIsEditingName(false);
				setNameValue(worker.name);
			}
		},
		[handleSaveName, worker.name],
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
					{isEditingName ? (
						<Input
							ref={nameInputRef}
							value={nameValue}
							onChange={(e) => setNameValue(e.target.value)}
							onBlur={handleSaveName}
							onKeyDown={handleNameKeyDown}
							className="h-7 text-base font-semibold px-1 py-0 border-border/50 max-w-xs"
						/>
					) : (
						<button
							type="button"
							onClick={() => onUpdateName && setIsEditingName(true)}
							className={`text-base font-semibold text-foreground truncate hover:bg-muted/50 rounded px-1 -mx-1 transition-colors ${onUpdateName ? "cursor-text" : "cursor-default"}`}
						>
							{worker.name}
						</button>
					)}
					<StatusDot
						status={
							status === "active" ? "active" : status === "automations_paused" ? "paused" : "error"
						}
						size="sm"
					/>
				</div>
				{isEditingDesc ? (
					<Input
						ref={descInputRef}
						value={descValue}
						onChange={(e) => setDescValue(e.target.value)}
						onBlur={handleSaveDesc}
						onKeyDown={handleDescKeyDown}
						placeholder="Add a description..."
						className="h-6 text-xs mt-0.5 px-1 py-0 border-border/50"
					/>
				) : (
					<Button
						variant="ghost"
						onClick={() => onUpdateDescription && setIsEditingDesc(true)}
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
