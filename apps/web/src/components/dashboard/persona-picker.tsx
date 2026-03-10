"use client";

import { WorkerOrb } from "@/components/automations/worker-card";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { OpenCodeIcon } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkers } from "@/hooks/automations/use-workers";
import type { SelectedPersona } from "@/stores/dashboard";
import { useDashboardStore } from "@/stores/dashboard";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

interface PersonaPickerProps {
	disabled?: boolean;
}

export function PersonaPicker({ disabled }: PersonaPickerProps) {
	const [open, setOpen] = useState(false);
	const { data: workers } = useWorkers();
	const { selectedPersona, setSelectedPersona, setSelectedModel } = useDashboardStore();

	// Guard: reset to opencode if selected coworker no longer exists
	useEffect(() => {
		if (selectedPersona.type !== "coworker" || !workers) return;
		const exists = workers.some((w) => w.id === selectedPersona.workerId);
		if (!exists) {
			setSelectedPersona({ type: "opencode" });
		}
	}, [workers, selectedPersona, setSelectedPersona]);

	const selectPersona = (persona: SelectedPersona) => {
		setSelectedPersona(persona);
		if (persona.type === "coworker" && persona.modelId) {
			setSelectedModel(persona.modelId as Parameters<typeof setSelectedModel>[0]);
		}
		setOpen(false);
	};

	const isOpenCode = selectedPersona.type === "opencode";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" className="h-8 gap-2 font-normal" disabled={disabled}>
					{isOpenCode ? (
						<OpenCodeIcon className="h-3.5 w-3.5 shrink-0" />
					) : (
						<>
							<div className="shrink-0">
								<WorkerOrb name={selectedPersona.name} size={18} />
							</div>
							<span className="truncate max-w-[120px]">{selectedPersona.name}</span>
						</>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-64 p-0" align="start">
				<Command>
					<CommandList>
						<CommandGroup heading="Default">
							<CommandItem value="opencode" onSelect={() => selectPersona({ type: "opencode" })}>
								{isOpenCode ? (
									<Check className="h-4 w-4 text-primary shrink-0" />
								) : (
									<OpenCodeIcon className="h-4 w-4 shrink-0" />
								)}
								<span>OpenCode</span>
							</CommandItem>
						</CommandGroup>

						{workers && workers.length > 0 && (
							<>
								<CommandSeparator />
								<CommandGroup heading="Coworkers">
									{workers.map((worker) => {
										const isSelected =
											selectedPersona.type === "coworker" && selectedPersona.workerId === worker.id;
										return (
											<CommandItem
												key={worker.id}
												value={worker.name}
												onSelect={() =>
													selectPersona({
														type: "coworker",
														workerId: worker.id,
														name: worker.name,
														modelId: worker.modelId ?? null,
													})
												}
											>
												{isSelected ? (
													<Check className="h-4 w-4 text-primary shrink-0" />
												) : (
													<div className="shrink-0">
														<WorkerOrb name={worker.name} size={18} />
													</div>
												)}
												<span className="truncate">{worker.name}</span>
											</CommandItem>
										);
									})}
								</CommandGroup>
							</>
						)}

						<CommandEmpty>No coworkers found.</CommandEmpty>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
