"use client";

import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import {
	ClaudeIcon,
	DeepSeekIcon,
	GeminiIcon,
	MistralIcon,
	OpenAIIcon,
	XAIIcon,
} from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PROVIDER_LABELS } from "@/config/automations";
import { EFFORT_OPTIONS } from "@/config/reasoning";
import { cn } from "@/lib/display/utils";
import {
	DEFAULT_AGENT_TYPE,
	type ModelId,
	type ModelProvider,
	type ReasoningEffort,
	getModel,
	getModelsForAgent,
} from "@proliferate/shared/agents";
import { Check, ChevronRight } from "lucide-react";
import type { FC } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ModelSelectorProps {
	modelId: ModelId;
	onChange: (modelId: ModelId) => void;
	disabled?: boolean;
	/** "outline" (default) for standalone, "ghost" for borderless, "chip" for inline property row */
	variant?: "outline" | "ghost" | "chip";
	/** Extra classes for the trigger button (e.g. borderless when embedded in a stacked list) */
	triggerClassName?: string;
	/** When provided, shows a flyout effort picker for models that support reasoning. */
	reasoningEffort?: ReasoningEffort;
	/** Callback when reasoning effort changes. Only used when reasoningEffort is provided. */
	onReasoningChange?: (effort: ReasoningEffort) => void;
}

const ProviderIcon: FC<{ provider: ModelProvider; className?: string }> = ({
	provider,
	className,
}) => {
	switch (provider) {
		case "anthropic":
			return <ClaudeIcon className={className} />;
		case "openai":
			return <OpenAIIcon className={className} />;
		case "google":
			return <GeminiIcon className={className} />;
		case "deepseek":
			return <DeepSeekIcon className={className} />;
		case "xai":
			return <XAIIcon className={className} />;
		case "mistral":
			return <MistralIcon className={className} />;
	}
};

/** Flyout card portalled to document.body, positioned next to the hovered row. */
function EffortFlyout({
	anchorRef,
	modelId,
	selectedModelId,
	effort,
	onSelect,
	onMouseEnter,
	onMouseLeave,
}: {
	anchorRef: React.RefObject<HTMLDivElement | null>;
	modelId: ModelId;
	selectedModelId: ModelId;
	effort: ReasoningEffort;
	onSelect: (modelId: ModelId, effort: ReasoningEffort) => void;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
}) {
	const [pos, setPos] = useState<{ top: number; left: number; height: number } | null>(null);

	useLayoutEffect(() => {
		const el = anchorRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		setPos({ top: rect.top, left: rect.right, height: rect.height });
	}, [anchorRef]);

	if (!pos) return null;

	return createPortal(
		<div
			className="fixed z-[100]"
			style={{ top: pos.top, left: pos.left }}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
		>
			{/* Invisible bridge so the cursor can travel from the row to the card */}
			<div className="absolute top-0 left-0 w-2" style={{ height: pos.height }} />
			<div className="rounded-lg border border-border bg-popover p-1 shadow-md w-[180px] ml-1">
				{EFFORT_OPTIONS.map((opt) => {
					const isActive = modelId === selectedModelId && opt.id === effort;
					return (
						<Button
							key={opt.id}
							type="button"
							variant="ghost"
							size="sm"
							className={cn(
								"flex flex-col items-start w-full rounded-md px-1.5 py-2 h-auto text-left font-normal",
								isActive ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-muted",
							)}
							onClick={(e) => {
								e.stopPropagation();
								onSelect(modelId, opt.id);
							}}
						>
							<div className="flex items-center gap-2 w-full">
								{isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
								<span className={cn("text-sm leading-none", !isActive && "ml-5")}>{opt.label}</span>
							</div>
							<span className="text-[11px] text-muted-foreground mt-1 ml-5">{opt.description}</span>
						</Button>
					);
				})}
			</div>
		</div>,
		document.body,
	);
}

/** Wrapper for a model row that shows a flyout on hover when reasoning is supported. */
function ModelRow({
	model,
	isSelected,
	showReasoning,
	reasoningEffort,
	selectedModelId,
	onModelSelect,
	onEffortSelect,
}: {
	model: {
		id: ModelId;
		name: string;
		description: string;
		provider: ModelProvider;
		supportsReasoning?: boolean;
	};
	isSelected: boolean;
	showReasoning: boolean;
	reasoningEffort: ReasoningEffort;
	selectedModelId: ModelId;
	onModelSelect: (id: ModelId) => void;
	onEffortSelect: (id: ModelId, effort: ReasoningEffort) => void;
}) {
	const [hovered, setHovered] = useState(false);
	const rowRef = useRef<HTMLDivElement>(null);
	const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const hasReasoning = showReasoning && model.supportsReasoning;

	const handleEnter = useCallback(() => {
		clearTimeout(leaveTimer.current);
		setHovered(true);
	}, []);

	const handleLeave = useCallback(() => {
		leaveTimer.current = setTimeout(() => setHovered(false), 100);
	}, []);

	return (
		<div
			ref={rowRef}
			className="relative"
			onMouseEnter={hasReasoning ? handleEnter : undefined}
			onMouseLeave={hasReasoning ? handleLeave : undefined}
		>
			<CommandItem
				value={`${model.name} ${model.description} ${PROVIDER_LABELS[model.provider]}`}
				onSelect={() => onModelSelect(model.id)}
				className="flex items-start gap-2"
			>
				{isSelected ? (
					<Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
				) : (
					<ProviderIcon provider={model.provider} className="h-4 w-4 mt-0.5 shrink-0" />
				)}
				<div className="flex flex-col items-start min-w-0 flex-1">
					<span className="leading-none">{model.name}</span>
					<span className="text-xs text-muted-foreground mt-1">{model.description}</span>
				</div>
				{hasReasoning && (
					<ChevronRight className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0 ml-auto" />
				)}
			</CommandItem>
			{hasReasoning && hovered && (
				<EffortFlyout
					anchorRef={rowRef}
					modelId={model.id}
					selectedModelId={selectedModelId}
					effort={reasoningEffort}
					onSelect={onEffortSelect}
					onMouseEnter={handleEnter}
					onMouseLeave={handleLeave}
				/>
			)}
		</div>
	);
}

export function ModelSelector({
	modelId,
	onChange,
	disabled,
	variant = "outline",
	triggerClassName,
	reasoningEffort,
	onReasoningChange,
}: ModelSelectorProps) {
	const [open, setOpen] = useState(false);
	const models = getModelsForAgent(DEFAULT_AGENT_TYPE);
	const currentModel = getModel(DEFAULT_AGENT_TYPE, modelId);
	const showReasoning = reasoningEffort !== undefined && onReasoningChange !== undefined;

	// Group models by provider for the dropdown
	const providers: ModelProvider[] = [
		"anthropic",
		"openai",
		"google",
		"deepseek",
		"xai",
		"mistral",
	];
	const grouped = providers
		.map((p) => ({
			provider: p,
			models: models.filter((m) => m.provider === p),
		}))
		.filter((g) => g.models.length > 0);

	const buttonVariant = variant === "chip" ? "ghost" : variant;

	// Trigger label: show effort next to model name when reasoning is active and not normal
	const effortLabel =
		showReasoning && currentModel?.supportsReasoning && reasoningEffort !== "normal"
			? EFFORT_OPTIONS.find((o) => o.id === reasoningEffort)?.label
			: null;

	const handleModelSelect = (id: ModelId) => {
		onChange(id);
		setOpen(false);
	};

	const handleEffortSelect = (id: ModelId, effort: ReasoningEffort) => {
		if (id !== modelId) {
			onChange(id);
		}
		onReasoningChange?.(effort);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant={buttonVariant}
					size="sm"
					className={cn(
						"gap-2 font-normal",
						variant === "chip" ? "h-7 px-2 text-sm bg-muted/50 hover:bg-muted rounded-md" : "h-8",
						triggerClassName,
					)}
					disabled={disabled}
				>
					<ProviderIcon
						provider={currentModel?.provider ?? "anthropic"}
						className="h-4 w-4 shrink-0"
					/>
					<span className="truncate max-w-[150px]">
						{currentModel?.name ?? modelId}
						{effortLabel && <span className="text-muted-foreground"> · {effortLabel}</span>}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-0 !animate-none !transition-none" align="start">
				<Command>
					<CommandInput placeholder="Search models..." />
					<CommandList>
						<CommandEmpty>No models found.</CommandEmpty>
						{grouped.map((group, groupIndex) => (
							<div key={group.provider}>
								{groupIndex > 0 && <CommandSeparator />}
								<CommandGroup heading={PROVIDER_LABELS[group.provider]}>
									{group.models.map((model) => (
										<ModelRow
											key={model.id}
											model={model}
											isSelected={model.id === modelId}
											showReasoning={showReasoning}
											reasoningEffort={reasoningEffort ?? "normal"}
											selectedModelId={modelId}
											onModelSelect={handleModelSelect}
											onEffortSelect={handleEffortSelect}
										/>
									))}
								</CommandGroup>
							</div>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
