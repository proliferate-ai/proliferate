"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { KeyRound, Save, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "proliferate_setup_intro_seen";

export function SetupIntroModal() {
	const [isOpen, setIsOpen] = useState(false);

	useEffect(() => {
		const hasSeen = localStorage.getItem(STORAGE_KEY);
		if (!hasSeen) {
			setIsOpen(true);
		}
	}, []);

	const handleClose = () => {
		localStorage.setItem(STORAGE_KEY, "true");
		setIsOpen(false);
	};

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) handleClose();
			}}
		>
			<DialogContent className="sm:max-w-[480px]">
				<DialogHeader>
					<DialogTitle className="text-lg">Welcome to Setup Mode</DialogTitle>
					<DialogDescription className="text-sm text-muted-foreground">
						This is a one-time initialization session. The AI agent will configure this repository
						so future coding sessions start instantly.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4 py-3">
					<div className="flex gap-3 items-start">
						<div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
							<Terminal className="w-4 h-4 text-muted-foreground" />
						</div>
						<div>
							<p className="text-sm font-medium">1. The agent builds the foundation</p>
							<p className="text-xs text-muted-foreground mt-0.5">
								It installs dependencies, configures databases, and starts local services
								autonomously.
							</p>
						</div>
					</div>
					<div className="flex gap-3 items-start">
						<div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
							<KeyRound className="w-4 h-4 text-muted-foreground" />
						</div>
						<div>
							<p className="text-sm font-medium">2. Provide missing secrets</p>
							<p className="text-xs text-muted-foreground mt-0.5">
								If the project requires third-party API keys, the agent will prompt you with a
								secure form in the chat.
							</p>
						</div>
					</div>
					<div className="flex gap-3 items-start">
						<div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
							<Save className="w-4 h-4 text-muted-foreground" />
						</div>
						<div>
							<p className="text-sm font-medium">3. Save the snapshot when ready</p>
							<p className="text-xs text-muted-foreground mt-0.5">
								Once verified, click "Done — Save Snapshot" at the top. All future coding sessions
								will boot from this saved state.
							</p>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button onClick={handleClose} className="w-full">
						Got it, let's start
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
