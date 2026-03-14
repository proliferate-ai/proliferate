"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useAddRepoBinding, useRemoveRepoBinding } from "@/hooks/org/use-secrets";
import { useState } from "react";

interface SecretBindingsModalProps {
	secret: {
		id: string;
		key: string;
		repoBindings: Array<{ id: string; repoId: string }>;
	} | null;
	repos: Array<{ id: string; githubRepoName: string }>;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function SecretBindingsModal({
	secret,
	repos,
	open,
	onOpenChange,
}: SecretBindingsModalProps) {
	const addRepoBinding = useAddRepoBinding();
	const removeRepoBinding = useRemoveRepoBinding();
	const [pendingRepoId, setPendingRepoId] = useState<string | null>(null);
	const [error, setError] = useState("");

	const bindingIds = new Set(secret?.repoBindings.map((binding) => binding.repoId) ?? []);

	const handleToggle = async (repoId: string, checked: boolean) => {
		if (!secret) return;

		setPendingRepoId(repoId);
		setError("");

		try {
			if (checked) {
				await addRepoBinding.mutateAsync({
					secretId: secret.id,
					repoId,
				});
			} else {
				await removeRepoBinding.mutateAsync({
					secretId: secret.id,
					repoId,
				});
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update repo bindings");
		} finally {
			setPendingRepoId(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="font-mono text-sm">{secret?.key}</DialogTitle>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<p className="text-xs text-muted-foreground">
						Choose which repositories can access this secret. Leave all unchecked to make it
						available to every repository.
					</p>

					<div className="space-y-3">
						{repos.length === 0 ? (
							<p className="text-sm text-muted-foreground">Add a repository first.</p>
						) : (
							repos.map((repo) => {
								const checked = bindingIds.has(repo.id);
								const isPending = pendingRepoId === repo.id;

								return (
									<label
										key={repo.id}
										className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
									>
										<Checkbox
											checked={checked}
											disabled={isPending}
											onCheckedChange={(value) => {
												void handleToggle(repo.id, value === true);
											}}
										/>
										<span className="truncate">{repo.githubRepoName}</span>
									</label>
								);
							})
						)}
					</div>

					{error && <p className="text-xs text-destructive">{error}</p>}
				</div>

				<DialogFooter>
					<Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
