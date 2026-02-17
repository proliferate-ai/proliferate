"use client";

import { Button } from "@/components/ui/button";
import { ClaudeIcon, GeminiIcon, OpenAIIcon } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
	DEFAULT_AGENT_TYPE,
	type ModelId,
	type ModelProvider,
	getModel,
	getModelsForAgent,
} from "@proliferate/shared/agents";
import { Check } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";

interface ModelSelectorProps {
	modelId: ModelId;
	onChange: (modelId: ModelId) => void;
	disabled?: boolean;
	/** Use "ghost" for borderless in toolbars, "outline" (default) for standalone */
	variant?: "outline" | "ghost";
	/** Extra classes for the trigger button (e.g. borderless when embedded in a stacked list) */
	triggerClassName?: string;
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
	}
};

export function ModelSelector({
	modelId,
	onChange,
	disabled,
	variant = "outline",
	triggerClassName,
}: ModelSelectorProps) {
	const [open, setOpen] = useState(false);
	const models = getModelsForAgent(DEFAULT_AGENT_TYPE);
	const currentModel = getModel(DEFAULT_AGENT_TYPE, modelId);

	// Group models by provider for the dropdown
	const providers: ModelProvider[] = ["anthropic", "openai", "google"];
	const grouped = providers
		.map((p) => ({
			provider: p,
			models: models.filter((m) => m.provider === p),
		}))
		.filter((g) => g.models.length > 0);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant={variant}
					size="sm"
					className={cn("h-8 gap-2 font-normal", triggerClassName)}
					disabled={disabled}
				>
					<ProviderIcon
						provider={currentModel?.provider ?? "anthropic"}
						className="h-4 w-4 shrink-0"
					/>
					<span className="truncate max-w-[150px]">{currentModel?.name ?? modelId}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-0" align="start">
				<div className="py-1">
					{grouped.map((group, groupIndex) => (
						<div key={group.provider}>
							{groupIndex > 0 && <div className="h-px bg-border mx-3 my-1" />}
							{group.models.map((model) => {
								const isSelected = model.id === modelId;
								return (
									<Button
										key={model.id}
										variant="ghost"
										className={cn(
											"w-full h-auto flex items-start justify-start gap-2 px-3 py-2 text-sm font-normal rounded-none",
											isSelected && "bg-primary/10",
										)}
										onClick={() => {
											onChange(model.id);
											setOpen(false);
										}}
									>
										{isSelected ? (
											<Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
										) : (
											<ProviderIcon provider={model.provider} className="h-4 w-4 mt-0.5 shrink-0" />
										)}
										<div className="flex flex-col items-start min-w-0">
											<span className="leading-none">{model.name}</span>
											<span className="text-xs text-muted-foreground mt-1">
												{model.description}
											</span>
										</div>
									</Button>
								);
							})}
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
