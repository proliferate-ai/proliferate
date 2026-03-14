"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateSecretValue } from "@/hooks/org/use-secrets";
import { useState } from "react";

interface SecretEditModalProps {
	secretId: string | null;
	secretKey: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function SecretEditModal({ secretId, secretKey, open, onOpenChange }: SecretEditModalProps) {
	const updateValue = useUpdateSecretValue();

	const [newValue, setNewValue] = useState("");
	const [error, setError] = useState("");

	const handleSave = async () => {
		if (!secretId || !newValue.trim()) return;
		setError("");

		try {
			await updateValue.mutateAsync({
				id: secretId,
				value: newValue.trim(),
			});
			setNewValue("");
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update secret");
		}
	};

	const isPending = updateValue.isPending;
	const hasChanges = newValue.trim() !== "";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="font-mono text-sm">{secretKey}</DialogTitle>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<div className="space-y-2">
						<Label className="text-xs">New Value</Label>
						<Input
							value={newValue}
							onChange={(e) => setNewValue(e.target.value)}
							placeholder="Enter new value"
							type="password"
							className="h-8 text-sm"
						/>
					</div>

					{error && <p className="text-xs text-destructive">{error}</p>}
				</div>

				<DialogFooter>
					<Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSave} disabled={isPending || !hasChanges}>
						{isPending ? "Saving..." : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
