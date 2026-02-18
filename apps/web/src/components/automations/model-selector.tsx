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
	/** "outline" (default) for standalone, "ghost" for borderless, "chip" for inline property row */
	variant?: "outline" | "ghost" | "chip";
	/** Extra classes for the trigger button (e.g. borderless when embedded in a stacked list) */
	triggerClassName?: string;
}

const PROVIDER_LABELS: Record<ModelProvider, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	google: "Google",
	deepseek: "DeepSeek",
	xai: "xAI",
	mistral: "Mistral",
};

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
					<span className="truncate max-w-[150px]">{currentModel?.name ?? modelId}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-0" align="start">
				<Command>
					<CommandInput placeholder="Search models..." />
					<CommandList>
						<CommandEmpty>No models found.</CommandEmpty>
						{grouped.map((group, groupIndex) => (
							<div key={group.provider}>
								{groupIndex > 0 && <CommandSeparator />}
								<CommandGroup heading={PROVIDER_LABELS[group.provider]}>
									{group.models.map((model) => {
										const isSelected = model.id === modelId;
										return (
											<CommandItem
												key={model.id}
												value={`${model.name} ${model.description} ${PROVIDER_LABELS[model.provider]}`}
												onSelect={() => {
													onChange(model.id);
													setOpen(false);
												}}
												className="flex items-start gap-2"
											>
												{isSelected ? (
													<Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
												) : (
													<ProviderIcon
														provider={model.provider}
														className="h-4 w-4 mt-0.5 shrink-0"
													/>
												)}
												<div className="flex flex-col items-start min-w-0">
													<span className="leading-none">{model.name}</span>
													<span className="text-xs text-muted-foreground mt-1">
														{model.description}
													</span>
												</div>
											</CommandItem>
										);
									})}
								</CommandGroup>
							</div>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
