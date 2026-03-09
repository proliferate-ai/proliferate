"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveDirectIntegration } from "@/hooks/integrations/use-integrations";
import { Check, Database, Loader2 } from "lucide-react";
import { useState } from "react";

interface DirectSetupFormProps {
	integrationId: "mysql";
	name: string;
	onClose: () => void;
}

const PLACEHOLDERS: Record<string, string> = {
	mysql: "mysql://user:password@host:3306/database",
};

const LABELS: Record<string, string> = {
	mysql: "MySQL connection URL",
};

export function DirectSetupForm({ integrationId, name, onClose }: DirectSetupFormProps) {
	const [connectionString, setConnectionString] = useState("");
	const [displayName, setDisplayName] = useState(name);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const mutation = useSaveDirectIntegration();

	const handleSubmit = async () => {
		const trimmed = connectionString.trim();
		if (!trimmed) {
			setError("Connection URL is required.");
			return;
		}
		if (!trimmed.startsWith("mysql://") && !trimmed.startsWith("mysql2://")) {
			setError("Connection URL must start with mysql:// or mysql2://");
			return;
		}
		setError(null);
		try {
			await mutation.mutateAsync({
				integrationId,
				displayName: displayName.trim() || name,
				connectionString: trimmed,
			});
			setConnectionString("");
			setSuccess(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save integration");
		}
	};

	if (success) {
		return (
			<div className="space-y-3">
				<div className="rounded-lg border border-success/30 bg-success/5 p-4">
					<div className="flex items-center gap-2">
						<Check className="h-4 w-4 text-success" />
						<span className="text-sm font-medium text-success">{name} connected</span>
					</div>
					<p className="text-xs text-muted-foreground mt-1">
						Your agent can now query this database using read-only actions.
					</p>
				</div>
				<div className="flex justify-end">
					<Button variant="ghost" size="sm" onClick={onClose}>
						Done
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border/80 bg-background p-4">
			<div className="flex items-center gap-2.5 mb-3">
				<div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
					<Database className="h-4 w-4 text-muted-foreground" />
				</div>
				<div>
					<h4 className="text-sm font-medium">{name}</h4>
					<p className="text-xs text-muted-foreground">
						Connect a database for secure, agent-accessible queries
					</p>
				</div>
			</div>

			<div className="space-y-3">
				<div>
					<Label className="text-xs">Display name</Label>
					<Input
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
						placeholder={name}
						className="h-8 text-sm mt-1"
					/>
				</div>

				<div>
					<Label className="text-xs">{LABELS[integrationId] ?? "Connection URL"}</Label>
					<Input
						type="password"
						value={connectionString}
						onChange={(e) => setConnectionString(e.target.value)}
						placeholder={PLACEHOLDERS[integrationId] ?? ""}
						className="h-8 text-sm mt-1 font-mono"
						autoFocus
					/>
				</div>

				<div className="text-xs text-muted-foreground space-y-0.5">
					<p>
						<span className="text-muted-foreground/70">Security:</span> Read-only by default, 25s
						query timeout, 1000 row limit
					</p>
					<p>
						<span className="text-muted-foreground/70">Credentials:</span> Encrypted at rest, never
						exposed to sandbox
					</p>
				</div>

				{error && <p className="text-xs text-destructive">{error}</p>}

				<div className="flex items-center justify-end gap-2 pt-1">
					<Button variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSubmit} disabled={mutation.isPending}>
						{mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
						Connect
					</Button>
				</div>
			</div>
		</div>
	);
}
