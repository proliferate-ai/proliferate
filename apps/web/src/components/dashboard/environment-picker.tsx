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
import { GithubIcon } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useGitHubAppConnect } from "@/hooks/integrations/use-github-app-connect";
import { useIntegrations } from "@/hooks/integrations/use-integrations";
import {
	type NangoProvider,
	shouldUseNangoForProvider,
	useNangoConnect,
} from "@/hooks/integrations/use-nango-connect";
import { useRepos } from "@/hooks/org/use-repos";
import { useConfigurations } from "@/hooks/sessions/use-configurations";
import { orpc } from "@/lib/infra/orpc";
import { useDashboardStore } from "@/stores/dashboard";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Layers, Pencil } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

interface EnvironmentPickerProps {
	disabled?: boolean;
}

/**
 * Display a GitHub repo name (owner/repo) with the owner dimmed.
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
	const queryClient = useQueryClient();
	const { data: repos } = useRepos();
	const { data: configurations } = useConfigurations("ready");
	const { data: integrationsData } = useIntegrations();
	const { selectedRepoId, selectedSnapshotId, setSelectedRepo, setSelectedSnapshot } =
		useDashboardStore();

	// GitHub connection state
	const hasGitHub =
		integrationsData?.integrations?.some(
			(i) => (i.provider === "github" || i.provider === "github-app") && i.status === "active",
		) ?? false;

	const invalidateIntegrations = () => {
		queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
	};
	const { connect: nangoConnect, loadingProvider: nangoLoadingProvider } = useNangoConnect({
		flow: "auth",
		onSuccess: invalidateIntegrations,
	});
	const { connect: githubAppConnect, isLoading: githubAppLoading } = useGitHubAppConnect({
		onSuccess: invalidateIntegrations,
	});
	const connectGitHub = () => {
		if (shouldUseNangoForProvider("github")) {
			nangoConnect("github" as NangoProvider);
		} else {
			githubAppConnect();
		}
	};
	const githubConnecting = githubAppLoading || (nangoLoadingProvider as string) === "github";

	const allRepos = repos ?? [];
	const multiRepoConfigs =
		configurations?.filter((p) => (p.configurationRepos?.length ?? 0) >= 2) ?? [];

	// Clear stale persisted selections when data loads (e.g. repo/configuration was deleted)
	useEffect(() => {
		if (!repos) return;
		if (selectedRepoId && !repos.some((r) => r.id === selectedRepoId)) {
			setSelectedRepo(null);
			setSelectedSnapshot(null);
		} else if (selectedRepoId) {
			const repo = repos.find((r) => r.id === selectedRepoId);
			if (repo && selectedSnapshotId !== (repo.configurationId ?? null)) {
				setSelectedSnapshot(repo.configurationId ?? null);
			}
		} else if (selectedSnapshotId && !selectedRepoId) {
			if (configurations && !configurations.some((c) => c.id === selectedSnapshotId)) {
				setSelectedSnapshot(null);
			}
		}
	}, [
		repos,
		configurations,
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
		? (selectedRepo.githubRepoName.split("/").pop() ?? selectedRepo.githubRepoName)
		: selectedConfig
			? (selectedConfig.name ?? "Untitled")
			: "Scratch session";

	// Show "Set up environment?" when a repo is selected but has no ready configuration
	const needsSetup = selectedRepo && selectedRepo.configurationStatus !== "ready";

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
		<div className="flex items-center gap-1.5">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button variant="ghost" size="sm" className="h-8 gap-2 font-normal" disabled={disabled}>
						{hasSelection ? (
							<GithubIcon className="h-4 w-4 shrink-0" />
						) : (
							<Pencil className="h-3.5 w-3.5 shrink-0" />
						)}
						<span className="truncate max-w-[200px]">{triggerLabel}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-80 p-0" align="start">
					<Command>
						<CommandInput placeholder="Search repos and configurations..." />
						<CommandList>
							<CommandEmpty>
								{!hasGitHub && allRepos.length === 0 ? (
									<div className="flex flex-col items-center gap-2 py-2">
										<p className="text-sm text-muted-foreground">
											Connect GitHub to import your repositories
										</p>
										<Button
											size="sm"
											variant="outline"
											className="gap-2"
											onClick={connectGitHub}
											disabled={githubConnecting}
										>
											<GithubIcon className="h-4 w-4" />
											{githubConnecting ? "Connecting..." : "Connect GitHub"}
										</Button>
									</div>
								) : (
									"No results found."
								)}
							</CommandEmpty>

							{/* Scratch session */}
							<CommandGroup>
								<CommandItem
									value="scratch-session"
									onSelect={() => {
										setSelectedRepo(null);
										setSelectedSnapshot(null);
										setOpen(false);
									}}
								>
									{!hasSelection ? (
										<Check className="h-4 w-4 text-primary shrink-0" />
									) : (
										<Pencil className="h-3.5 w-3.5 shrink-0" />
									)}
									<span>Scratch session</span>
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

							{/* Connect GitHub prompt */}
							{!hasGitHub && allRepos.length === 0 && (
								<>
									<CommandSeparator />
									<CommandGroup heading="Get started">
										<CommandItem
											value="connect-github"
											onSelect={connectGitHub}
											className="flex items-center gap-2"
										>
											<GithubIcon className="h-4 w-4 shrink-0" />
											<span>Connect GitHub</span>
											<span className="text-muted-foreground text-xs ml-auto shrink-0">
												Import repos
											</span>
										</CommandItem>
									</CommandGroup>
								</>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>

			{needsSetup && (
				<TooltipProvider delayDuration={200}>
					<Tooltip>
						<TooltipTrigger asChild>
							<Link
								href={`/workspace/onboard?repo=${selectedRepo.id}`}
								className="text-xs text-muted-foreground hover:underline hover:text-foreground transition-colors whitespace-nowrap"
							>
								Set up environment?
							</Link>
						</TooltipTrigger>
						<TooltipContent side="bottom" className="max-w-[260px] text-center">
							<p>
								Setting up an environment installs dependencies and creates a snapshot so future
								sessions start instantly with everything pre-configured.
							</p>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)}
		</div>
	);
}
