"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GithubIcon, Loader2, Lock, Search } from "@/components/ui/icons";
import { Label } from "@/components/ui/label";
import { useFinalizeOnboarding } from "@/hooks/use-onboarding";
import { useAvailableRepos } from "@/hooks/use-repos";
import { useOnboardingStore } from "@/stores/onboarding";
import { useEffect, useRef, useState } from "react";

interface StepRepoSelectionProps {
	onComplete: () => void;
}

export function StepRepoSelection({ onComplete }: StepRepoSelectionProps) {
	const selectedRepoIds = useOnboardingStore((state) => state.selectedRepoIds);
	const setSelectedRepoIds = useOnboardingStore((state) => state.setSelectedRepoIds);
	const toggleRepoSelection = useOnboardingStore((state) => state.toggleRepoSelection);
	const hasInitializedRef = useRef(false);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const [searchQuery, setSearchQuery] = useState("");

	const { data, isLoading, error } = useAvailableRepos();

	const finalizeMutation = useFinalizeOnboarding();

	const handleFinalize = async (params: {
		selectedGithubRepoIds: number[];
		integrationId: string;
	}) => {
		await finalizeMutation.mutateAsync(params);
		onComplete();
	};

	// Auto-select all repos on first load (only once)
	useEffect(() => {
		if (data?.repositories && !hasInitializedRef.current) {
			hasInitializedRef.current = true;
			setSelectedRepoIds(data.repositories.map((repo) => String(repo.id)));
		}
	}, [data?.repositories, setSelectedRepoIds]);

	// Auto-focus search input when repos are loaded
	useEffect(() => {
		if (data?.repositories && data.repositories.length > 0) {
			searchInputRef.current?.focus();
		}
	}, [data?.repositories]);

	const repositories = data?.repositories || [];
	const filteredRepositories = repositories.filter((repo) =>
		repo.full_name.toLowerCase().includes(searchQuery.toLowerCase()),
	);
	const integrationId = data?.integrationId;
	const allSelected = repositories.length > 0 && selectedRepoIds.length === repositories.length;
	const noneSelected = selectedRepoIds.length === 0;

	const handleToggleAll = () => {
		if (allSelected) {
			setSelectedRepoIds([]);
		} else {
			setSelectedRepoIds(repositories.map((repo) => String(repo.id)));
		}
	};

	const handleContinue = () => {
		if (!integrationId || selectedRepoIds.length === 0) return;

		handleFinalize({
			selectedGithubRepoIds: selectedRepoIds.map((id) => Number(id)),
			integrationId,
		});
	};

	// Loading state
	if (isLoading) {
		return (
			<div className="w-full max-w-[480px]">
				<div className="rounded-2xl overflow-hidden border border-border">
					<div className="relative bg-gradient-to-br from-[#24292e] to-[#1a1e22] h-48 flex items-center justify-center">
						<div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
							<Loader2 className="h-10 w-10 text-white animate-spin" />
						</div>
						<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
							<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
								Repositories
							</span>
						</div>
					</div>
					<div className="p-6 bg-card">
						<div className="text-center">
							<h1 className="text-xl font-semibold text-foreground">Loading repositories...</h1>
							<p className="mt-2 text-sm text-muted-foreground">
								Fetching available repositories from GitHub.
							</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<div className="w-full max-w-[480px]">
				<div className="rounded-2xl overflow-hidden border border-border">
					<div className="relative bg-gradient-to-br from-[#24292e] to-[#1a1e22] h-48 flex items-center justify-center">
						<div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
							<GithubIcon className="h-10 w-10 text-white" />
						</div>
						<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
							<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
								Error
							</span>
						</div>
					</div>
					<div className="p-6 bg-card">
						<div className="text-center">
							<h1 className="text-xl font-semibold text-foreground">Unable to load repositories</h1>
							<p className="mt-2 text-sm text-muted-foreground">
								Please ensure the GitHub App is installed on your repositories.
							</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// No repos available
	if (repositories.length === 0) {
		return (
			<div className="w-full max-w-[480px]">
				<div className="rounded-2xl overflow-hidden border border-border">
					<div className="relative bg-gradient-to-br from-[#24292e] to-[#1a1e22] h-48 flex items-center justify-center">
						<div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
							<GithubIcon className="h-10 w-10 text-white" />
						</div>
						<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
							<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
								Repositories
							</span>
						</div>
					</div>
					<div className="p-6 bg-card">
						<div className="text-center">
							<h1 className="text-xl font-semibold text-foreground">No repositories found</h1>
							<p className="mt-2 text-sm text-muted-foreground">
								Install the GitHub App on your repositories first, then return here.
							</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Main repo selection UI
	return (
		<div className="w-full max-w-[480px]">
			<div className="rounded-2xl overflow-hidden border border-border">
				{/* Header */}
				<div className="relative bg-gradient-to-br from-[#24292e] to-[#1a1e22] h-48 flex items-center justify-center">
					<div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
						<GithubIcon className="h-10 w-10 text-white" />
					</div>
					<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
						<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
							Sandbox
						</span>
					</div>
				</div>

				{/* Content */}
				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-xl font-semibold text-foreground">Select repositories</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							These repos will be cloned into your agent's cloud environment. You'll configure
							dependencies and services next, then save everything as a snapshot for instant starts.
						</p>
					</div>

					{/* Search bar */}
					<div className="relative mb-4">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
						<input
							ref={searchInputRef}
							type="text"
							placeholder="Search repositories..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="w-full h-10 pl-10 pr-4 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-shadow"
						/>
					</div>

					{/* Select All / Deselect All */}
					<div className="mb-3">
						<Button
							variant="link"
							onClick={handleToggleAll}
							className="h-auto p-0 text-sm text-muted-foreground hover:text-foreground"
						>
							{allSelected ? "Deselect All" : "Select All"}
						</Button>
					</div>

					{/* Repository list */}
					<div className="space-y-2 max-h-48 overflow-y-auto mb-5">
						{filteredRepositories.length === 0 ? (
							<div className="py-8 text-center text-sm text-muted-foreground">
								No repositories match "{searchQuery}"
							</div>
						) : (
							filteredRepositories.map((repo) => {
								const isSelected = selectedRepoIds.includes(String(repo.id));
								return (
									<Label
										key={repo.id}
										className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
									>
										<Checkbox
											checked={isSelected}
											onCheckedChange={() => toggleRepoSelection(String(repo.id))}
										/>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												<span className="text-sm font-medium text-foreground truncate">
													{repo.full_name}
												</span>
												{repo.private && (
													<Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
												)}
											</div>
										</div>
									</Label>
								);
							})
						)}
					</div>

					{/* Continue button */}
					<Button
						variant="dark"
						onClick={handleContinue}
						disabled={noneSelected || finalizeMutation.isPending}
						className="h-11 w-full rounded-lg"
					>
						{finalizeMutation.isPending ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								Setting up...
							</>
						) : noneSelected ? (
							"Select repositories"
						) : (
							`Continue with ${selectedRepoIds.length} ${selectedRepoIds.length === 1 ? "repository" : "repositories"}`
						)}
					</Button>

					{finalizeMutation.error && (
						<p className="mt-3 text-sm text-red-500 text-center">
							{finalizeMutation.error.message}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
