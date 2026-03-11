"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ORB_PALETTES } from "@/config/coworkers";
import { cn } from "@/lib/display/utils";
import { useState } from "react";
import { WorkerOrb } from "./worker-card";

/** Names that deterministically map to each palette index (0–11) via the hashName function. */
const PALETTE_PREVIEW_NAMES = [
	"chip",
	"atom",
	"fire",
	"ace",
	"beta",
	"pen",
	"elm",
	"cyan",
	"ivy",
	"edge",
	"apex",
	"aura",
];

interface OrbPickerProps {
	/** Currently selected palette index (0–11), or null for no selection. */
	selectedIndex: number | null;
	/** Called when the user picks a palette. */
	onSelect: (index: number) => void;
	/** The element rendered as the popover trigger. If omitted, a default WorkerOrb is shown. */
	children?: React.ReactNode;
}

/**
 * Popover that displays the 12 orb palettes in a grid and lets users pick one.
 */
export function OrbPicker({ selectedIndex, onSelect, children }: OrbPickerProps) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				{children ?? (
					<Button type="button" variant="ghost" className="rounded-full cursor-pointer h-auto p-0">
						<WorkerOrb
							name={selectedIndex != null ? PALETTE_PREVIEW_NAMES[selectedIndex] : "default"}
							size={40}
						/>
					</Button>
				)}
			</PopoverTrigger>
			<PopoverContent className="w-auto p-3" align="start" sideOffset={8}>
				<p className="text-xs font-medium text-muted-foreground mb-2">Choose orb style</p>
				<div className="grid grid-cols-4 gap-2">
					{ORB_PALETTES.map((_, i) => (
						<Button
							key={PALETTE_PREVIEW_NAMES[i]}
							type="button"
							variant="ghost"
							onClick={() => {
								onSelect(i);
								setOpen(false);
							}}
							className={cn(
								"rounded-full p-0.5 h-auto transition-all",
								selectedIndex === i
									? "ring-2 ring-foreground"
									: "ring-1 ring-transparent hover:ring-border",
							)}
						>
							<WorkerOrb name={PALETTE_PREVIEW_NAMES[i]} size={36} />
						</Button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}

/**
 * The preview names used to render each palette. Exported so the create dialog
 * can derive the right name to pass to WorkerOrb for preview.
 */
export { PALETTE_PREVIEW_NAMES };
