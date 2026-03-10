"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ORB_PALETTES } from "@/config/coworkers";
import { cn } from "@/lib/display/utils";
import { useState } from "react";
import { WorkerOrb } from "./worker-card";

/** Names that deterministically map to each palette index via the hashName function. */
const PALETTE_PREVIEW_NAMES = [
	"alpha",
	"bravo",
	"charlie",
	"dev",
	"echo",
	"foxtrot",
	"golf",
	"hotel",
];

interface OrbPickerProps {
	/** Currently selected palette index (0-7), or null for no selection. */
	selectedIndex: number | null;
	/** Called when the user picks a palette. */
	onSelect: (index: number) => void;
	/** The element rendered as the popover trigger. If omitted, a default WorkerOrb is shown. */
	children?: React.ReactNode;
}

/**
 * Popover that displays the 8 orb palettes in a grid and lets users pick one.
 */
export function OrbPicker({ selectedIndex, onSelect, children }: OrbPickerProps) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				{children ?? (
					<button
						type="button"
						className="rounded-xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<WorkerOrb
							name={selectedIndex != null ? PALETTE_PREVIEW_NAMES[selectedIndex] : "default"}
							size={40}
						/>
					</button>
				)}
			</PopoverTrigger>
			<PopoverContent className="w-auto p-3" align="start" sideOffset={8}>
				<p className="text-xs font-medium text-muted-foreground mb-2">Choose orb style</p>
				<div className="grid grid-cols-4 gap-2">
					{ORB_PALETTES.map((_, i) => (
						<button
							key={PALETTE_PREVIEW_NAMES[i]}
							type="button"
							onClick={() => {
								onSelect(i);
								setOpen(false);
							}}
							className={cn(
								"rounded-xl p-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								selectedIndex === i
									? "ring-2 ring-foreground"
									: "ring-1 ring-transparent hover:ring-border",
							)}
						>
							<WorkerOrb name={PALETTE_PREVIEW_NAMES[i]} size={36} />
						</button>
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
