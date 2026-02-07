"use client";

import { Button } from "@/components/ui/button";
import { FolderPlusIcon } from "@/components/ui/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getSetupInitialPrompt } from "@/lib/prompts";
import { useDashboardStore } from "@/stores/dashboard";
import * as Popover from "@radix-ui/react-popover";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SnapshotSelector } from "./snapshot-selector";

export function AddSnapshotButton() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const { setMobileSidebarOpen, setPendingPrompt } = useDashboardStore();

	const handleCreate = (_prebuildId: string, sessionId: string) => {
		setOpen(false);
		setMobileSidebarOpen(false);
		setPendingPrompt(getSetupInitialPrompt());
		router.push(`/dashboard/sessions/${sessionId}`);
	};

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Popover.Trigger asChild>
							<Button variant="ghost" size="icon" className="h-5 w-5">
								<FolderPlusIcon className="h-3.5 w-3.5" />
							</Button>
						</Popover.Trigger>
					</TooltipTrigger>
					<TooltipContent side="right">
						<p className="text-xs">New Configuration</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>

			<Popover.Portal>
				<Popover.Content
					className="z-50 rounded-lg border border-border bg-popover shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95"
					sideOffset={8}
					align="start"
				>
					<SnapshotSelector mode="create" onCreate={handleCreate} />
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

export function AddSnapshotRow() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const { setMobileSidebarOpen, setPendingPrompt } = useDashboardStore();

	const handleCreate = (_prebuildId: string, sessionId: string) => {
		setOpen(false);
		setMobileSidebarOpen(false);
		setPendingPrompt(getSetupInitialPrompt());
		router.push(`/dashboard/sessions/${sessionId}`);
	};

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger asChild>
				<Button
					variant="ghost"
					className="w-full h-auto flex items-center justify-start gap-[0.38rem] px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground"
				>
					<FolderPlusIcon className="h-5 w-5" />
					<span>New configuration</span>
				</Button>
			</Popover.Trigger>

			<Popover.Portal>
				<Popover.Content
					className="z-50 rounded-xl border border-border bg-popover shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95"
					sideOffset={8}
					align="start"
				>
					<SnapshotSelector mode="create" onCreate={handleCreate} />
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
