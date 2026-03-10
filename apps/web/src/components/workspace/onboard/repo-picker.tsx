"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/display/utils";
import { Check, FolderGit2 } from "lucide-react";

interface RepoPickerProps {
	repos: Array<{ id: string; githubRepoName: string }>;
	selectedRepoId: string | null;
	onSelect: (id: string) => void;
}

export function RepoPicker({ repos, selectedRepoId, onSelect }: RepoPickerProps) {
	return (
		<div>
			<h3 className="text-sm font-medium mb-2">Repository</h3>
			<p className="text-xs text-muted-foreground mb-3">Select the repository to set up.</p>
			{repos.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No repositories found. Add one in Settings first.
				</p>
			) : (
				<div className="space-y-1.5 max-h-48 overflow-y-auto">
					{repos.map((repo) => {
						const isSelected = repo.id === selectedRepoId;
						return (
							<Button
								key={repo.id}
								variant="outline"
								aria-pressed={isSelected}
								className={cn(
									"w-full justify-start gap-2 h-9 text-sm",
									isSelected && "border-primary bg-primary/5",
								)}
								onClick={() => onSelect(repo.id)}
							>
								<FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span className="truncate">{repo.githubRepoName}</span>
								{isSelected && <Check className="h-3.5 w-3.5 ml-auto shrink-0 text-primary" />}
							</Button>
						);
					})}
				</div>
			)}
		</div>
	);
}
