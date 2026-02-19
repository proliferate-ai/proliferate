"use client";

import { Button } from "@/components/ui/button";
import {
	ProliferateIconDeep,
	ProliferateIconNormal,
	ProliferateIconQuick,
} from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
	DEFAULT_AGENT_TYPE,
	type ModelId,
	type ReasoningEffort,
	getModel,
} from "@proliferate/shared/agents";
import { Check } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";

interface ReasoningSelectorProps {
	modelId: ModelId;
	effort: ReasoningEffort;
	onChange: (effort: ReasoningEffort) => void;
	disabled?: boolean;
}

interface IconProps {
	className?: string;
}

const EFFORT_ICONS: Record<ReasoningEffort, FC<IconProps>> = {
	quick: ProliferateIconQuick,
	normal: ProliferateIconNormal,
	deep: ProliferateIconDeep,
};

const EFFORT_OPTIONS: { id: ReasoningEffort; label: string; description: string }[] = [
	{ id: "quick", label: "Quick", description: "Minimal reasoning, fastest responses" },
	{ id: "normal", label: "Normal", description: "Balanced reasoning (default)" },
	{ id: "deep", label: "Deep", description: "Maximum reasoning depth" },
];

export function ReasoningSelector({ modelId, effort, onChange, disabled }: ReasoningSelectorProps) {
	const [open, setOpen] = useState(false);

	const model = getModel(DEFAULT_AGENT_TYPE, modelId);
	if (!model?.supportsReasoning) return null;

	const currentOption = EFFORT_OPTIONS.find((o) => o.id === effort) ?? EFFORT_OPTIONS[1];
	const CurrentIcon = EFFORT_ICONS[effort];

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-8 gap-1.5 font-normal whitespace-nowrap"
					disabled={disabled}
				>
					<CurrentIcon className="h-3.5 w-3.5 shrink-0" />
					<span className="text-sm">{currentOption.label}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-64 p-0" align="start">
				<div className="py-1">
					{EFFORT_OPTIONS.map((option) => {
						const isSelected = option.id === effort;
						const OptionIcon = EFFORT_ICONS[option.id];
						return (
							<Button
								key={option.id}
								variant="ghost"
								className={cn(
									"w-full h-auto flex items-start justify-start gap-2 px-3 py-2 text-sm font-normal rounded-none",
									isSelected && "bg-primary/10",
								)}
								onClick={() => {
									onChange(option.id);
									setOpen(false);
								}}
							>
								{isSelected ? (
									<Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
								) : (
									<OptionIcon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
								)}
								<div className="flex flex-col items-start min-w-0">
									<span className="leading-none">{option.label}</span>
									<span className="text-xs text-muted-foreground mt-1">{option.description}</span>
								</div>
							</Button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}
