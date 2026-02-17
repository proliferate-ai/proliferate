"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { FolderPlusIcon } from "@/components/ui/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getSetupInitialPrompt } from "@/lib/prompts";
import { useDashboardStore } from "@/stores/dashboard";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CreateSnapshotContent } from "./snapshot-selector";

export function AddSnapshotButton() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const { setMobileSidebarOpen, setPendingPrompt } = useDashboardStore();

	const handleCreate = (_configurationId: string, sessionId: string) => {
		setOpen(false);
		setMobileSidebarOpen(false);
		setPendingPrompt(getSetupInitialPrompt());
		router.push(`/workspace/${sessionId}`);
	};

	return (
		<>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setOpen(true)}>
							<FolderPlusIcon className="h-3.5 w-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">
						<p className="text-xs">New Configuration</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
					<DialogHeader className="sr-only">
						<DialogTitle>New configuration</DialogTitle>
						<DialogDescription>Group the repositories that make up your project</DialogDescription>
					</DialogHeader>
					<CreateSnapshotContent onCreate={handleCreate} />
				</DialogContent>
			</Dialog>
		</>
	);
}

export function AddSnapshotRow() {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const { setMobileSidebarOpen, setPendingPrompt } = useDashboardStore();

	const handleCreate = (_configurationId: string, sessionId: string) => {
		setOpen(false);
		setMobileSidebarOpen(false);
		setPendingPrompt(getSetupInitialPrompt());
		router.push(`/workspace/${sessionId}`);
	};

	return (
		<>
			<Button
				variant="ghost"
				className="w-full h-auto flex items-center justify-start gap-[0.38rem] px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground"
				onClick={() => setOpen(true)}
			>
				<FolderPlusIcon className="h-5 w-5" />
				<span>New configuration</span>
			</Button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
					<DialogHeader className="sr-only">
						<DialogTitle>New configuration</DialogTitle>
						<DialogDescription>Group the repositories that make up your project</DialogDescription>
					</DialogHeader>
					<CreateSnapshotContent onCreate={handleCreate} />
				</DialogContent>
			</Dialog>
		</>
	);
}
