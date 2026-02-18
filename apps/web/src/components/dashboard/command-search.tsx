"use client";

import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { useAutomations, useCreateAutomation } from "@/hooks/use-automations";
import { useSessions } from "@/hooks/use-sessions";
import { useDashboardStore } from "@/stores/dashboard";
import { Activity, Plus, Search, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { AutomationRow } from "./automation-row";
import { SessionRow } from "./session-row";

interface CommandSearchProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
	const router = useRouter();
	const { setActiveSession, clearPendingPrompt } = useDashboardStore();

	// Fetch sessions
	const { data: sessions } = useSessions();

	// Fetch automations
	const { data: automations = [] } = useAutomations();

	// Create automation mutation
	const createAutomation = useCreateAutomation();

	// Filter out setup sessions
	const filteredSessions = sessions?.filter((session) => session.sessionType !== "setup");

	const handleNewSession = useCallback(() => {
		clearPendingPrompt();
		setActiveSession(null);
		router.push("/dashboard");
		onOpenChange(false);
	}, [clearPendingPrompt, setActiveSession, router, onOpenChange]);

	const handleNewAutomation = useCallback(async () => {
		try {
			const automation = await createAutomation.mutateAsync({});
			router.push(`/dashboard/automations/${automation.id}`);
		} catch (error) {
			console.error("Failed to create automation:", error);
		}
		onOpenChange(false);
	}, [createAutomation, router, onOpenChange]);

	const handleSelectSession = useCallback(
		(sessionId: string) => {
			clearPendingPrompt();
			setActiveSession(sessionId);
			router.push(`/workspace/${sessionId}`);
			onOpenChange(false);
		},
		[clearPendingPrompt, setActiveSession, router, onOpenChange],
	);

	const handleSelectAutomation = useCallback(
		(automationId: string) => {
			router.push(`/dashboard/automations/${automationId}`);
			onOpenChange(false);
		},
		[router, onOpenChange],
	);

	return (
		<CommandDialog open={open} onOpenChange={onOpenChange}>
			<CommandInput autoFocus placeholder="Search sessions and automations..." />
			<CommandList>
				<CommandEmpty>No results found.</CommandEmpty>

				{/* Quick Actions */}
				<CommandGroup heading="Actions">
					<CommandItem onSelect={handleNewSession}>
						<Plus className="mr-2 h-4 w-4" />
						<span>New Session</span>
					</CommandItem>
					<CommandItem onSelect={handleNewAutomation}>
						<Plus className="mr-2 h-4 w-4" />
						<span>New Automation</span>
					</CommandItem>
				</CommandGroup>

				<CommandSeparator />

				{/* Navigation */}
				<CommandGroup heading="Navigate">
					<CommandItem
						onSelect={() => {
							router.push("/dashboard/my-work");
							onOpenChange(false);
						}}
					>
						<User className="mr-2 h-4 w-4" />
						<span>My Work</span>
					</CommandItem>
					<CommandItem
						onSelect={() => {
							router.push("/dashboard/activity");
							onOpenChange(false);
						}}
					>
						<Activity className="mr-2 h-4 w-4" />
						<span>Activity</span>
					</CommandItem>
				</CommandGroup>

				<CommandSeparator />

				{/* Sessions */}
				{filteredSessions && filteredSessions.length > 0 && (
					<CommandGroup heading="Sessions">
						{filteredSessions.slice(0, 10).map((session) => (
							<CommandItem key={session.id} onSelect={() => handleSelectSession(session.id)}>
								<SessionRow
									title={session.title}
									repoName={session.repo?.githubRepoName || null}
									branchName={session.branchName}
									status={session.status}
									lastActivityAt={session.lastActivityAt}
									startedAt={session.startedAt}
								/>
							</CommandItem>
						))}
					</CommandGroup>
				)}

				{/* Automations */}
				{automations.length > 0 && (
					<CommandGroup heading="Automations">
						{automations.slice(0, 10).map((automation) => (
							<CommandItem
								key={automation.id}
								onSelect={() => handleSelectAutomation(automation.id)}
							>
								<AutomationRow
									name={automation.name}
									enabled={automation.enabled}
									updatedAt={automation.updated_at}
									providers={automation.activeProviders}
								/>
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
		<button
			type="button"
			onClick={onClick}
			className="group flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
		>
			<Search className="h-5 w-5" />
			<span className="flex-1 text-left text-sm">Search</span>
			<kbd className="hidden sm:inline-flex opacity-0 group-hover:opacity-100 transition-opacity h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
				<span className="text-xs">⌘</span>K
			</kbd>
		</button>
	);
}
