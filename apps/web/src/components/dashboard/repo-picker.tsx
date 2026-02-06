"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { useAvailableRepos, useCreateRepo } from "@/hooks/use-repos";
import type { GitHubRepo } from "@/types";
import { useEffect, useState } from "react";

interface RepoPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRepoAdded?: () => void;
}

export function RepoPicker({ open, onOpenChange, onRepoAdded }: RepoPickerProps) {
	const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
	const [error, setError] = useState<string | null>(null);

	const { data, isLoading, refetch } = useAvailableRepos();
	const repositories = data?.repositories || [];

	const createRepo = useCreateRepo();

	// Reset state when dialog closes
	useEffect(() => {
		if (!open) {
			setSelectedRepo(null);
			setError(null);
		}
	}, [open]);

	const handleAddRepo = async () => {
		if (!selectedRepo) return;

		setError(null);

		try {
			await createRepo.mutateAsync({
				githubRepoId: String(selectedRepo.id),
				githubRepoName: selectedRepo.full_name,
				githubUrl: selectedRepo.html_url,
				defaultBranch: selectedRepo.default_branch,
			});

			onOpenChange(false);
			onRepoAdded?.();
		} catch (err) {
			console.error("Failed to add repo:", err);
			setError("Failed to add repository. Please try again.");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Add Repository</DialogTitle>
					<DialogDescription>Select a repository from your GitHub installations.</DialogDescription>
				</DialogHeader>

				<div className="mt-4">
					{isLoading ? (
						<Text variant="body" color="muted" className="text-center py-4">
							Loading repositories...
						</Text>
					) : repositories.length > 0 ? (
						<div className="space-y-2 max-h-64 overflow-y-auto">
							{repositories.map((repo) => (
								<Button
									key={repo.id}
									variant="ghost"
									onClick={() => setSelectedRepo(repo)}
									className={`w-full h-auto text-left p-3 rounded-lg border transition-colors ${
										selectedRepo?.id === repo.id
											? "border-primary bg-primary/5"
											: "border-border hover:bg-muted"
									}`}
								>
									<div className="flex items-center justify-between w-full">
										<div>
											<Text variant="small" className="font-medium">
												{repo.full_name}
											</Text>
											<Text variant="small" color="muted">
												{repo.default_branch}
											</Text>
										</div>
										{repo.private && (
											<Text
												variant="small"
												color="muted"
												className="text-xs bg-muted px-2 py-1 rounded"
											>
												Private
											</Text>
										)}
									</div>
								</Button>
							))}
						</div>
					) : (
						<div className="text-center py-4">
							<Text variant="body" color="muted">
								No repositories found.
							</Text>
							<Button variant="link" onClick={() => refetch()} className="mt-2 p-0 h-auto text-sm">
								Refresh list
							</Button>
						</div>
					)}

					{error && (
						<Text variant="small" color="destructive" className="mt-2">
							{error}
						</Text>
					)}

					<div className="flex justify-end gap-2 mt-4">
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button onClick={handleAddRepo} disabled={!selectedRepo || createRepo.isPending}>
							{createRepo.isPending ? "Adding..." : "Add Repository"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
