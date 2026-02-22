"use client";

import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, Layers } from "lucide-react";
import { useState } from "react";

interface Configuration {
	id: string;
	name: string | null;
	status: string | null;
}

interface ConfigurationSelectorProps {
	configurations: Configuration[];
	selectedId: string | null;
	onChange: (id: string) => void;
	triggerClassName?: string;
}

export function ConfigurationSelector({
	configurations,
	selectedId,
	onChange,
	triggerClassName,
}: ConfigurationSelectorProps) {
	const [open, setOpen] = useState(false);
	const selected = configurations.find((c) => c.id === selectedId);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className={cn("gap-2 font-normal h-8", triggerClassName)}
				>
					<Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					<span className="truncate max-w-[180px]">
						{selected ? selected.name || "Untitled configuration" : "No configuration"}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-0" align="start">
				<Command>
					<CommandInput placeholder="Search configurations..." />
					<CommandList>
						<CommandEmpty>No configurations found.</CommandEmpty>
						{configurations.map((config) => {
							const isSelected = config.id === selectedId;
							return (
								<CommandItem
									key={config.id}
									value={config.id}
									keywords={[config.name || "Untitled configuration"]}
									onSelect={() => {
										onChange(config.id);
										setOpen(false);
									}}
									className="flex items-center gap-2"
								>
									{isSelected ? (
										<Check className="h-4 w-4 text-primary shrink-0" />
									) : (
										<span className="h-4 w-4 shrink-0" />
									)}
									<span className="truncate">{config.name || "Untitled configuration"}</span>
								</CommandItem>
							);
						})}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
