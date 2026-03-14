"use client";

import { Button } from "@/components/ui/button";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { useSessions } from "@/hooks/sessions/use-sessions";
import { useDashboardStore } from "@/stores/dashboard";
import { Search, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

interface CommandSearchProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
	const router = useRouter();
	const { setActiveSession } = useDashboardStore();

	// Fetch sessions
	const { data: sessions } = useSessions();

	const handleSelectSession = useCallback(
		(sessionId: string) => {
			setActiveSession(sessionId);
			router.push("/sessions");
			onOpenChange(false);
		},
		[setActiveSession, router, onOpenChange],
	);

	return (
		<CommandDialog open={open} onOpenChange={onOpenChange}>
			<CommandInput autoFocus placeholder="Search sessions..." />
			<CommandList>
				<CommandEmpty>No results found.</CommandEmpty>

				{/* Navigation */}
				<CommandGroup heading="Navigate">
					<CommandItem
						onSelect={() => {
							router.push("/sessions");
							onOpenChange(false);
						}}
					>
						<Search className="mr-2 h-4 w-4" />
						<span>Sessions</span>
					</CommandItem>
					<CommandItem
						onSelect={() => {
							router.push("/settings/profile");
							onOpenChange(false);
						}}
					>
						<Settings className="mr-2 h-4 w-4" />
						<span>Settings</span>
					</CommandItem>
				</CommandGroup>

				<CommandSeparator />

				{/* Sessions */}
				{sessions && sessions.length > 0 && (
					<CommandGroup heading="Sessions">
						{sessions.slice(0, 10).map((session) => (
							<CommandItem key={session.id} onSelect={() => handleSelectSession(session.id)}>
								<div className="flex-1 min-w-0">
									<p className="text-sm truncate font-medium">
										{session.initialPrompt || "Untitled"}
									</p>
									<p className="text-xs text-muted-foreground truncate">
										{session.repo
											? `${session.repo.githubOrg}/${session.repo.githubName}`
											: "No repo"}
									</p>
								</div>
							</CommandItem>
						))}
					</CommandGroup>
				)}
			</CommandList>
		</CommandDialog>
	);
}

// Search trigger button component for sidebar
interface SearchTriggerProps {
	onClick: () => void;
}

export function SearchTrigger({ onClick }: SearchTriggerProps) {
	return (
		<Button
			type="button"
			variant="ghost"
			onClick={onClick}
			className="group flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
		>
			<Search className="h-5 w-5" />
			<span className="flex-1 text-left text-sm">Search</span>
			<kbd className="hidden sm:inline-flex opacity-0 group-hover:opacity-100 transition-opacity h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
				<span className="text-xs">&#x2318;</span>K
			</kbd>
		</Button>
	);
}
