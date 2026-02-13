"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { Check, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

function CheckIcon({ active }: { active: boolean }) {
	return active ? (
		<Check className="h-3.5 w-3.5 text-foreground shrink-0" />
	) : (
		<span className="h-3.5 w-3.5 shrink-0" />
	);
}

export function SidebarOrganizeMenu() {
	const [open, setOpen] = useState(false);
	const {
		sidebarOrganize,
		sidebarSort,
		sidebarStatusFilter,
		setSidebarOrganize,
		setSidebarSort,
		setSidebarStatusFilter,
	} = useDashboardStore();

	const hasNonDefaultPrefs =
		sidebarOrganize !== "chronological" ||
		sidebarSort !== "updated" ||
		sidebarStatusFilter !== "all";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className={cn("h-5 w-5", hasNonDefaultPrefs && "text-primary")}
				>
					<SlidersHorizontal className="h-3.5 w-3.5" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-48 p-1 z-[60]" sideOffset={4}>
				<div className="flex flex-col">
					{/* Section: Organize */}
					<div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Organize</div>
					<button
						type="button"
						className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left"
						onClick={() => setSidebarOrganize("by-project")}
					>
						<CheckIcon active={sidebarOrganize === "by-project"} />
						By project
					</button>
					<button
						type="button"
						className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left"
						onClick={() => setSidebarOrganize("chronological")}
					>
						<CheckIcon active={sidebarOrganize === "chronological"} />
						Chronological
					</button>

					{/* Divider */}
					<div className="my-1 h-px bg-border" />

					{/* Section: Sort by */}
					<div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Sort by</div>
					<button
						type="button"
						className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left"
						onClick={() => setSidebarSort("updated")}
					>
						<CheckIcon active={sidebarSort === "updated"} />
						Updated
					</button>
					<button
						type="button"
						className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left"
						onClick={() => setSidebarSort("created")}
					>
						<CheckIcon active={sidebarSort === "created"} />
						Created
					</button>

					{/* Divider */}
					<div className="my-1 h-px bg-border" />

					{/* Section: Show */}
					<div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Show</div>
					<button
						type="button"
						className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left"
						onClick={() => setSidebarStatusFilter("all")}
					>
						<CheckIcon active={sidebarStatusFilter === "all"} />
						All sessions
					</button>
					<button
						type="button"
						className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left"
						onClick={() => setSidebarStatusFilter("running")}
					>
						<CheckIcon active={sidebarStatusFilter === "running"} />
						Running
					</button>
					<button
						type="button"
						className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left"
						onClick={() => setSidebarStatusFilter("paused")}
					>
						<CheckIcon active={sidebarStatusFilter === "paused"} />
						Paused
					</button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
