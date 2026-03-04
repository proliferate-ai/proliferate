"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { SettingsCard, SettingsRow } from "@/components/settings/settings-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useSecretsForm } from "@/hooks/settings/use-secrets-form";
import { Eye, EyeOff, Key, Plus, Trash2 } from "lucide-react";

export default function SecretsPage() {
	const {
		secrets,
		isLoading,
		isAdding,
		setIsAdding,
		newKey,
		setNewKey,
		newValue,
		setNewValue,
		newDescription,
		setNewDescription,
		showValue,
		setShowValue,
		error,
		isCreating,
		deletingId,
		resetForm,
		handleAdd,
		handleDelete,
	} = useSecretsForm();

	if (isLoading) {
		return (
			<PageShell title="Secrets" subtitle="Encrypted environment variables" maxWidth="2xl">
				<div className="space-y-4">
					{[1, 2].map((i) => (
						<div key={i} className="h-16 rounded-lg bg-muted/30 animate-pulse" />
					))}
				</div>
			</PageShell>
		);
	}

	return (
		<PageShell title="Secrets" subtitle="Encrypted environment variables" maxWidth="2xl">
			{isAdding ? (
					<div className="rounded-lg border border-border/80 bg-background p-4 space-y-4">
						<div className="space-y-2">
							<Label htmlFor="key">Key</Label>
							<Input
								id="key"
								placeholder="e.g., API_KEY"
								value={newKey}
								onChange={(e) => setNewKey(e.target.value.toUpperCase())}
								autoFocus
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="value">Value</Label>
							<div className="relative">
								<Input
									id="value"
									type={showValue ? "text" : "password"}
									placeholder="Enter secret value"
									value={newValue}
									onChange={(e) => setNewValue(e.target.value)}
									className="pr-10"
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
									onClick={() => setShowValue(!showValue)}
								>
									{showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
								</Button>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="description">Description (optional)</Label>
							<Input
								id="description"
								placeholder="What is this used for?"
								value={newDescription}
								onChange={(e) => setNewDescription(e.target.value)}
							/>
						</div>
						{error && <p className="text-sm text-destructive">{error}</p>}
						<div className="flex justify-end gap-2">
							<Button variant="outline" size="sm" onClick={resetForm}>
								Cancel
							</Button>
							<Button size="sm" onClick={handleAdd} disabled={isCreating}>
								{isCreating ? "Saving..." : "Add Secret"}
							</Button>
						</div>
					</div>
				) : secrets && secrets.length > 0 ? (
					<SettingsCard>
						{secrets.map((secret) => (
							<SettingsRow
								key={secret.id}
								label={secret.key}
								description={secret.description || undefined}
							>
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6 text-muted-foreground hover:text-destructive"
									onClick={() => handleDelete(secret.id)}
									disabled={deletingId === secret.id}
								>
									{deletingId === secret.id ? (
										<LoadingDots size="sm" />
									) : (
										<Trash2 className="h-3 w-3" />
									)}
								</Button>
							</SettingsRow>
						))}
						<li className="px-4 py-3">
							<Button
								variant="ghost"
								size="sm"
								className="w-full justify-start text-muted-foreground hover:text-foreground h-8"
								onClick={() => setIsAdding(true)}
							>
								<Plus className="h-4 w-4 mr-2" />
								Add Secret
							</Button>
						</li>
					</SettingsCard>
				) : (
					<div className="rounded-lg border border-dashed border-border/80 bg-background py-8 text-center">
						<Key className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
						<p className="text-sm text-muted-foreground">No secrets yet</p>
						<p className="text-xs text-muted-foreground mt-1">
							Secrets are encrypted and injected as environment variables
						</p>
						<Button variant="outline" size="sm" className="mt-4" onClick={() => setIsAdding(true)}>
							<Plus className="h-4 w-4 mr-2" />
							Add Secret
						</Button>
					</div>
				)}
		</PageShell>
	);
}
