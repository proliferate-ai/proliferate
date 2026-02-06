"use client";

import { Button } from "@/components/ui/button";
import { ClaudeIcon, OpenCodeIcon } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AGENTS, formatAgentModel, getAgent, getModel } from "@proliferate/shared/agents";
import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";

interface AgentModelSelectorProps {
	agentType: string;
	modelId: string;
	onChange: (agentType: string, modelId: string) => void;
	disabled?: boolean;
	/** Use "ghost" for borderless in toolbars, "outline" (default) for standalone */
	variant?: "outline" | "ghost";
	/** Extra classes for the trigger button (e.g. borderless when embedded in a stacked list) */
	triggerClassName?: string;
}

export function AgentModelSelector({
	agentType,
	modelId,
	onChange,
	disabled,
	variant = "outline",
	triggerClassName,
}: AgentModelSelectorProps) {
	const [open, setOpen] = useState(false);
	const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

	const currentAgent = getAgent(agentType);
	const currentModel = getModel(agentType, modelId);

	const handleSelectModel = (newAgentType: string, newModelId: string) => {
		onChange(newAgentType, newModelId);
		setOpen(false);
		setExpandedAgent(null);
	};

	// Get the appropriate icon for an agent
	const getAgentIcon = (agentId: string, isSelected: boolean) => {
		if (isSelected) {
			return <Check className="h-4 w-4 text-primary" />;
		}
		if (agentId === "opencode") {
			return <OpenCodeIcon className="h-4 w-4" />;
		}
		return <div className="w-4" />;
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant={variant}
					size="sm"
					className={cn("h-8 gap-2 font-normal", triggerClassName)}
					disabled={disabled}
				>
					{/* Side-by-side icons */}
					<div className="flex items-center gap-1">
						<OpenCodeIcon className="h-4 w-4" />
						<ClaudeIcon className="h-3.5 w-3.5" />
					</div>
					<span>{formatAgentModel(agentType, modelId)}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-56 p-0" align="start">
				<div className="py-1">
					{Object.values(AGENTS).map((agent) => (
						<div key={agent.id}>
							{/* Agent row */}
							<Button
								variant="ghost"
								className={cn(
									"w-full h-auto flex items-center justify-between px-3 py-2 text-sm rounded-none",
									expandedAgent === agent.id && "bg-muted",
								)}
								onClick={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
							>
								<div className="flex items-center gap-2">
									{getAgentIcon(agent.id, agentType === agent.id)}
									<span>{agent.name}</span>
								</div>
								<ChevronRight
									className={cn(
										"h-4 w-4 text-muted-foreground transition-transform",
										expandedAgent === agent.id && "rotate-90",
									)}
								/>
							</Button>

							{/* Model submenu */}
							{expandedAgent === agent.id && (
								<div className="bg-muted/50 py-1">
									{agent.models.map((model) => {
										const isSelectedModel = modelId === model.id && agentType === agent.id;
										return (
											<Button
												key={model.id}
												variant="ghost"
												className={cn(
													"w-full h-auto flex items-center justify-start gap-2 px-3 py-2 pl-8 text-sm rounded-none",
													isSelectedModel && "bg-primary/10",
												)}
												onClick={() => handleSelectModel(agent.id, model.id)}
											>
												{isSelectedModel ? (
													<Check className="h-4 w-4 text-primary" />
												) : (
													<ClaudeIcon className="h-4 w-4" />
												)}
												<span>{model.name}</span>
											</Button>
										);
									})}
								</div>
							)}
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
