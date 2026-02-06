"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingDots } from "@/components/ui/loading-dots";
import { Text } from "@/components/ui/text";
import { useCreateSecret, useDeleteSecret, useSecrets } from "@/hooks/use-secrets";
import { Eye, EyeOff, Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

export function SecretsTab() {
	const [isAdding, setIsAdding] = useState(false);
	const [newKey, setNewKey] = useState("");
	const [newValue, setNewValue] = useState("");
	const [newDescription, setNewDescription] = useState("");
	const [showValue, setShowValue] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	const { data: secrets, isLoading } = useSecrets();
	const createSecret = useCreateSecret();
	const deleteSecret = useDeleteSecret();

	const handleAdd = async () => {
		if (!newKey.trim() || !newValue.trim()) {
			setError("Key and value are required");
			return;
		}

		setError(null);

		try {
			await createSecret.mutateAsync({
				key: newKey.trim(),
				value: newValue.trim(),
				description: newDescription.trim() || undefined,
			});
			resetForm();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create secret");
		}
	};

	const handleDelete = async (id: string) => {
		setDeletingId(id);
		try {
			await deleteSecret.mutateAsync(id);
		} catch (err) {
			console.error("Failed to delete secret:", err);
		} finally {
			setDeletingId(null);
		}
	};

	const resetForm = () => {
		setIsAdding(false);
		setNewKey("");
		setNewValue("");
		setNewDescription("");
		setShowValue(false);
		setError(null);
	};

	return (
		<div className="space-y-4">
			<div className="mb-4">
				<Text variant="h4" className="text-lg">
					Secrets
				</Text>
				<Text variant="body" color="muted" className="text-sm">
					Encrypted environment variables for your sessions.
				</Text>
			</div>

			{/* Add new secret form */}
			{isAdding ? (
				<div className="p-4 border border-border rounded-lg space-y-3">
					<div className="space-y-2">
						<Label htmlFor="key">Key</Label>
						<Input
							id="key"
							placeholder="e.g., API_KEY"
							value={newKey}
							onChange={(e) => setNewKey(e.target.value.toUpperCase())}
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
					{error && (
						<Text variant="small" color="destructive">
							{error}
						</Text>
					)}
					<div className="flex justify-end gap-2">
						<Button variant="outline" onClick={resetForm}>
							Cancel
						</Button>
						<Button onClick={handleAdd} disabled={createSecret.isPending}>
							{createSecret.isPending ? "Saving..." : "Add Secret"}
						</Button>
					</div>
				</div>
			) : (
				<Button
					variant="outline"
					className="w-full justify-start"
					onClick={() => setIsAdding(true)}
				>
					<Plus className="h-4 w-4 mr-2" />
					Add Secret
				</Button>
			)}

			{/* Secrets list */}
			<div className="space-y-2">
				{isLoading ? (
					<div className="text-center py-4">
						<LoadingDots size="md" className="text-muted-foreground" />
					</div>
				) : secrets && secrets.length > 0 ? (
					secrets.map((secret) => (
						<div
							key={secret.id}
							className="flex items-center justify-between p-3 border border-border rounded-lg"
						>
							<div className="flex items-center gap-3">
								<Key className="h-4 w-4 text-muted-foreground" />
								<div>
									<p className="font-mono text-sm font-medium">{secret.key}</p>
									{secret.description && (
										<p className="text-xs text-muted-foreground">{secret.description}</p>
									)}
								</div>
							</div>
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8 text-muted-foreground hover:text-destructive"
								onClick={() => handleDelete(secret.id)}
								disabled={deletingId === secret.id}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>
					))
				) : (
					<p className="text-sm text-muted-foreground text-center py-4">
						No secrets yet. Secrets are encrypted and injected as environment variables.
					</p>
				)}
			</div>
		</div>
	);
}
