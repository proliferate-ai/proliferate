"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeleteSecret } from "@/hooks/org/use-secrets";
import type { Secret } from "@proliferate/shared/contracts/secrets";
import { Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

interface SecretsSectionProps {
	secrets: Secret[];
}

export function SecretsSection({ secrets }: SecretsSectionProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [showSearch, setShowSearch] = useState(false);

	const deleteSecret = useDeleteSecret();

	const filteredSecrets = useMemo(() => {
		if (!searchQuery) return secrets;
		const q = searchQuery.toLowerCase();
		return secrets.filter((s) => s.key.toLowerCase().includes(q));
	}, [secrets, searchQuery]);

	return (
		<section>
			<div className="flex items-center justify-between mb-3">
				<div>
					<h2 className="text-sm font-medium">
						Secrets
						{secrets.length > 0 && ` (${secrets.length})`}
					</h2>
					<p className="text-xs text-muted-foreground mt-0.5">
						Securely set environment variables for your agents.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{secrets.length > 0 && (
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							onClick={() => setShowSearch(!showSearch)}
						>
							<Search className="h-3.5 w-3.5" />
						</Button>
					)}
					<Button size="sm" className="h-8" asChild>
						<Link href="/settings/secrets">
							<Plus className="h-3.5 w-3.5 mr-1.5" />
							Add Secret
						</Link>
					</Button>
				</div>
			</div>

			{showSearch && (
				<div className="mb-3">
					<Input
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search secrets..."
						className="h-8 text-sm"
						autoFocus
					/>
				</div>
			)}

			{secrets.length === 0 ? (
				<div className="rounded-lg border border-dashed border-border/80 py-8 text-center">
					<p className="text-sm text-muted-foreground">No secrets yet</p>
					<p className="text-xs text-muted-foreground mt-1">
						Add environment variables to make them available to your agents.
					</p>
				</div>
			) : filteredSecrets.length === 0 ? (
				<p className="text-sm text-muted-foreground text-center py-8">
					No secrets matching &ldquo;{searchQuery}&rdquo;
				</p>
			) : (
				<div className="rounded-lg border border-border overflow-hidden">
					{/* Header */}
					<div
						className="grid items-center px-4 py-2 text-xs text-muted-foreground border-b border-border/50"
						style={{ gridTemplateColumns: "2fr 2fr 1fr 0.5fr" }}
					>
						<span>Name</span>
						<span>Repository</span>
						<span>Type</span>
						<span />
					</div>

					{/* Rows */}
					{filteredSecrets.map((secret) => (
						<div
							key={secret.id}
							className="grid items-center px-4 py-2.5 text-sm border-b border-border/30 last:border-b-0 hover:bg-muted/30 group"
							style={{
								gridTemplateColumns: "2fr 2fr 1fr 0.5fr",
							}}
						>
							<span className="font-mono text-xs truncate">{secret.key}</span>
							<span className="text-xs text-muted-foreground truncate">
								{secret.repo_id ? "Repo-scoped" : "All repositories"}
							</span>
							<span className="text-xs text-muted-foreground">
								{secret.secret_type === "redacted" ? "Redacted" : "Secret"}
							</span>
							<div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6"
									onClick={() => deleteSecret.mutate(secret.id)}
								>
									<Trash2 className="h-3 w-3" />
								</Button>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
