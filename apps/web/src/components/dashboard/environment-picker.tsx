"use client";

import { Button } from "@/components/ui/button";
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

export function EnvironmentPicker({ disabled }: EnvironmentPickerProps) {
	const [open, setOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const { data: repos } = useRepos();
	const { data: allConfigurations } = useConfigurations("ready");
	const { selectedRepoId, selectedSnapshotId, setSelectedRepo, setSelectedSnapshot } =
		useDashboardStore();

	const allRepos = repos ?? [];
	const multiRepoConfigs =
		allConfigurations?.filter((p) => (p.configurationRepos?.length ?? 0) >= 2) ?? [];

	// Clear stale persisted selections when data loads (e.g. repo/configuration was deleted)
	useEffect(() => {
		if (!repos) return;
		if (selectedRepoId && !repos.some((r) => r.id === selectedRepoId)) {
			// Repo no longer exists — clear both
			setSelectedRepo(null);
			setSelectedSnapshot(null);
		} else if (selectedSnapshotId && !selectedRepoId) {
			// Multi-repo config — check if it still exists
			if (allConfigurations && !allConfigurations.some((c) => c.id === selectedSnapshotId)) {
				setSelectedSnapshot(null);
			}
		}
	}, [
		repos,
		allConfigurations,
		selectedRepoId,
		selectedSnapshotId,
		setSelectedRepo,
		setSelectedSnapshot,
	]);

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
		// Find the first configuration that contains this repo
		const repoConfig = allConfigurations?.find((c) =>
			c.configurationRepos?.some((cr) => cr.repo?.id === repo.id),
		);
		if (repoConfig) {
			setSelectedSnapshot(repoConfig.id);
		} else {
			setSelectedSnapshot(null);
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
						{hasSelection ? <GithubIcon className="h-4 w-4" /> : <Terminal className="h-4 w-4" />}
						<span className="truncate max-w-[200px]">{triggerLabel}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-56 p-0" align="start">
					<div className="py-1">
						{/* Scratch / General assistant option */}
						<Button
							variant="ghost"
							className={cn(
								"w-full h-auto flex items-center justify-start gap-2 px-3 py-2 text-sm font-normal rounded-none",
								!hasSelection && "bg-primary/10",
							)}
							onClick={() => {
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
						</Button>

						{allRepos.length > 0 && <div className="h-px bg-border mx-3 my-1" />}

						{allRepos.map((repo) => {
							const isSelected = repo.id === selectedRepoId;
							return (
								<Button
									key={repo.id}
									variant="ghost"
									className={cn(
										"w-full h-auto flex items-center justify-start gap-2 px-3 py-2 text-sm font-normal rounded-none",
										isSelected && "bg-primary/10",
									)}
									onClick={() => selectRepo(repo)}
								>
									{isSelected ? (
										<Check className="h-4 w-4 text-primary shrink-0" />
									) : (
										<GithubIcon className="h-4 w-4 shrink-0" />
									)}
									<span className="truncate">{repo.githubRepoName}</span>
									<span className="text-muted-foreground text-xs ml-auto shrink-0">
										{allConfigurations?.some((c) =>
											c.configurationRepos?.some((cr) => cr.repo?.id === repo.id),
										)
											? "Configured"
											: "Not configured"}
									</span>
								</Button>
							);
						})}

						{multiRepoConfigs.length > 0 && allRepos.length > 0 && (
							<div className="h-px bg-border mx-3 my-1" />
						)}

						{multiRepoConfigs.map((config) => {
							const isSelected = config.id === selectedSnapshotId;
							return (
								<Button
									key={config.id}
									variant="ghost"
									className={cn(
										"w-full h-auto flex items-center justify-start gap-2 px-3 py-2 text-sm font-normal rounded-none",
										isSelected && "bg-primary/10",
									)}
									onClick={() => selectConfig(config)}
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
								</Button>
							);
						})}

						<div className="h-px bg-border mx-3 my-1" />

						<Button
							variant="ghost"
							className="w-full h-auto flex items-center justify-start gap-2 px-3 py-2 text-sm font-normal rounded-none text-muted-foreground"
							onClick={() => {
								setOpen(false);
								setCreateOpen(true);
							}}
						>
							<Plus className="h-4 w-4 shrink-0" />
							<span>New configuration</span>
						</Button>
					</div>
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
