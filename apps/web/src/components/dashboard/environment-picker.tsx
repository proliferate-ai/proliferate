"use client";

import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { GithubIcon } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConfigurations } from "@/hooks/use-configurations";
import { useRepos } from "@/hooks/use-repos";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { Check, Layers, Plus, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { CreateSnapshotContent } from "./snapshot-selector";

interface EnvironmentPickerProps {
	disabled?: boolean;
}

/**
 * Split a GitHub repo name (owner/repo) into parts for display.
 */
function RepoName({ name }: { name: string }) {
	const slashIndex = name.indexOf("/");
	if (slashIndex === -1) return <span className="truncate">{name}</span>;

	const owner = name.slice(0, slashIndex);
	const repo = name.slice(slashIndex + 1);

	return (
		<span className="truncate">
			<span className="text-muted-foreground">{owner}/</span>
			<span className="font-medium">{repo}</span>
		</span>
	);
}

export function EnvironmentPicker({ disabled }: EnvironmentPickerProps) {
	const [open, setOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const { data: repos } = useRepos();
	const { data: configurations } = useConfigurations("ready");
	const { selectedRepoId, selectedSnapshotId, setSelectedRepo, setSelectedSnapshot } =
		useDashboardStore();

	const allRepos = repos ?? [];
	const multiRepoConfigs = configurations?.filter((p) => (p.configurationRepos?.length ?? 0) >= 2) ?? [];

	// Clear stale persisted selections when data loads (e.g. repo/configuration was deleted)
	useEffect(() => {
		if (!repos) return;
		if (selectedRepoId && !repos.some((r) => r.id === selectedRepoId)) {
			setSelectedRepo(null);
			setSelectedSnapshot(null);
		} else if (selectedRepoId && selectedSnapshotId) {
			const repo = repos.find((r) => r.id === selectedRepoId);
			if (repo && selectedSnapshotId !== repo.configurationId) {
				setSelectedSnapshot(repo.configurationId ?? null);
			}
		} else if (selectedSnapshotId && !selectedRepoId) {
			if (configurations && !configurations.some((c) => c.id === selectedSnapshotId)) {
				setSelectedSnapshot(null);
			}
		}
	}, [repos, configurations, selectedRepoId, selectedSnapshotId, setSelectedRepo, setSelectedSnapshot]);

	// Find display name for the trigger
	const selectedRepo = allRepos.find((r) => r.id === selectedRepoId);
	const selectedConfig = multiRepoConfigs.find((c) => c.id === selectedSnapshotId);
	const hasSelection = Boolean(selectedRepo || selectedConfig);
	const triggerLabel = selectedRepo
		? selectedRepo.githubRepoName
		: selectedConfig
			? (selectedConfig.name ?? "Untitled")
			: "General assistant";

	const selectRepo = (repo: (typeof allRepos)[0]) => {
		setSelectedRepo(repo.id);
		if (repo.configurationId) {
			setSelectedSnapshot(repo.configurationId);
		}
		setOpen(false);
	};

	const selectConfig = (config: (typeof multiRepoConfigs)[0]) => {
		setSelectedRepo(null);
		setSelectedSnapshot(config.id);
		setOpen(false);
	};

	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button variant="ghost" size="sm" className="h-8 gap-2 font-normal" disabled={disabled}>
						{hasSelection ? (
							<GithubIcon className="h-4 w-4 shrink-0" />
						) : (
							<Terminal className="h-4 w-4 shrink-0" />
						)}
						<span className="truncate max-w-[200px]">{triggerLabel}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-80 p-0" align="start">
					<Command>
						<CommandInput placeholder="Search repos and configurations..." />
						<CommandList>
							<CommandEmpty>No results found.</CommandEmpty>

							{/* General assistant */}
							<CommandGroup>
								<CommandItem
									value="general-assistant"
									onSelect={() => {
										setSelectedRepo(null);
										setSelectedSnapshot(null);
										setOpen(false);
									}}
								>
									{!hasSelection ? (
										<Check className="h-4 w-4 text-primary shrink-0" />
									) : (
										<Terminal className="h-4 w-4 shrink-0" />
									)}
									<span>General assistant</span>
								</CommandItem>
							</CommandGroup>

							{/* Repos */}
							{allRepos.length > 0 && (
								<>
									<CommandSeparator />
									<CommandGroup heading="Repositories">
										{allRepos.map((repo) => {
											const isSelected = repo.id === selectedRepoId;
											return (
												<CommandItem
													key={repo.id}
													value={repo.githubRepoName}
													onSelect={() => selectRepo(repo)}
													className="flex items-center gap-2"
												>
													{isSelected ? (
														<Check className="h-4 w-4 text-primary shrink-0" />
													) : (
														<GithubIcon className="h-4 w-4 shrink-0" />
													)}
													<RepoName name={repo.githubRepoName} />
													<span className="text-muted-foreground text-xs ml-auto shrink-0">
														{repo.configurationStatus === "ready" ? "Configured" : ""}
													</span>
												</CommandItem>
											);
										})}
									</CommandGroup>
								</>
							)}

							{/* Multi-repo configurations */}
							{multiRepoConfigs.length > 0 && (
								<>
									<CommandSeparator />
									<CommandGroup heading="Configurations">
										{multiRepoConfigs.map((config) => {
											const isSelected = config.id === selectedSnapshotId;
											const repoNames =
												config.configurationRepos
													?.map((r) => r.repo?.githubRepoName)
													.filter(Boolean)
													.join(", ") ?? "";
											return (
												<CommandItem
													key={config.id}
													value={`${config.name ?? "Untitled"} ${repoNames}`}
													onSelect={() => selectConfig(config)}
													className="flex items-center gap-2"
												>
													{isSelected ? (
														<Check className="h-4 w-4 text-primary shrink-0" />
													) : (
														<Layers className="h-4 w-4 shrink-0" />
													)}
													<span className="truncate">{config.name ?? "Untitled"}</span>
													<span className="text-muted-foreground text-xs ml-auto shrink-0">
														{config.configurationRepos?.length} repos
													</span>
												</CommandItem>
											);
										})}
									</CommandGroup>
								</>
							)}

							{/* New configuration */}
							<CommandSeparator />
							<CommandGroup>
								<CommandItem
									value="new-configuration"
									onSelect={() => {
										setOpen(false);
										setCreateOpen(true);
									}}
									className="text-muted-foreground"
								>
									<Plus className="h-4 w-4 shrink-0" />
									<span>New configuration</span>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>

			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
					<DialogHeader className="sr-only">
						<DialogTitle>New configuration</DialogTitle>
						<DialogDescription>Group the repositories that make up your project</DialogDescription>
					</DialogHeader>
					<CreateSnapshotContent onCreate={() => setCreateOpen(false)} />
				</DialogContent>
			</Dialog>
		</>
	);
}
