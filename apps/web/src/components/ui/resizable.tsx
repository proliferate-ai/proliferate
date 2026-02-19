"use client";

import { cn } from "@/lib/utils";
import { GripVertical } from "lucide-react";
import {
	Group,
	type GroupProps,
	Panel,
	Separator,
	type SeparatorProps,
} from "react-resizable-panels";

function ResizablePanelGroup({ className, ...props }: GroupProps) {
	return (
		<Group
			className={cn("flex h-full w-full data-[orientation=vertical]:flex-col", className)}
			{...props}
		/>
	);
}

const ResizablePanel = Panel;

function ResizableHandle({
	withHandle,
	className,
	...props
}: SeparatorProps & {
	withHandle?: boolean;
}) {
	return (
		<Separator
			className={cn(
				"relative flex w-px items-center justify-center bg-border transition-colors hover:bg-primary/50 z-10 after:absolute after:inset-y-0 after:left-1/2 after:w-4 after:-translate-x-1/2 after:cursor-col-resize focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-4 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:-translate-y-1/2 data-[orientation=vertical]:after:translate-x-0 data-[orientation=vertical]:after:cursor-row-resize [&[data-orientation=vertical]>div]:rotate-90",
				className,
			)}
			{...props}
		>
			{withHandle && (
				<div className="z-20 flex h-6 w-1.5 items-center justify-center rounded-[2px] border bg-background shadow-sm">
					<GripVertical className="h-2.5 w-2.5 text-muted-foreground/60" />
				</div>
			)}
		</Separator>
	);
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
