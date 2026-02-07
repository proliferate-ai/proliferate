"use client";

import { Button } from "@/components/ui/button";
import { ClaudeIcon } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
	DEFAULT_AGENT_TYPE,
	type ModelId,
	getModel,
	getModelsForAgent,
} from "@proliferate/shared/agents";
import { Check } from "lucide-react";
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

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant={variant}
					size="sm"
					className={cn("h-8 gap-2 font-normal", triggerClassName)}
					disabled={disabled}
				>
					<ClaudeIcon className="h-4 w-4" />
					<span>{currentModel?.name ?? modelId}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-56 p-0" align="start">
				<div className="py-1">
					{models.map((model) => {
						const isSelected = model.id === modelId;
						return (
							<Button
								key={model.id}
								variant="ghost"
								className={cn(
									"w-full h-auto flex items-start justify-start gap-2 px-3 py-2 text-sm rounded-none",
									isSelected && "bg-primary/10",
								)}
								onClick={() => {
									onChange(model.id);
									setOpen(false);
								}}
							>
								{isSelected ? (
									<Check className="h-4 w-4 text-primary mt-0.5" />
								) : (
									<ClaudeIcon className="h-4 w-4 mt-0.5" />
								)}
								<div className="flex flex-col items-start">
									<span className="leading-none">{model.name}</span>
									<span className="text-xs text-muted-foreground mt-1">{model.description}</span>
								</div>
							</Button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}
