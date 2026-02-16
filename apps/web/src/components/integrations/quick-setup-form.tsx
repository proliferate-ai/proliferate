"use client";

import { ConnectorIcon } from "@/components/integrations/connector-icon";
import { ValidationResult } from "@/components/integrations/validation-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useCreateOrgConnectorWithSecret,
	useValidateOrgConnector,
} from "@/hooks/use-org-connectors";
import { useSecrets } from "@/hooks/use-secrets";
import type { ConnectorAuth, ConnectorPreset } from "@proliferate/shared";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";

export interface QuickSetupFormProps {
	preset: ConnectorPreset;
	onClose: () => void;
}

export function QuickSetupForm({ preset, onClose }: QuickSetupFormProps) {
	const [useExisting, setUseExisting] = useState(false);
	const [secretValue, setSecretValue] = useState("");
	const [existingSecretKey, setExistingSecretKey] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [successKey, setSuccessKey] = useState<string | null>(null);
	const quickMutation = useCreateOrgConnectorWithSecret();
	const validateMutation = useValidateOrgConnector();
	const { data: orgSecrets } = useSecrets();
	const secretOptions = orgSecrets ?? [];

	const handleSubmit = async () => {
		if (useExisting) {
			if (!existingSecretKey) {
				setError("Select an existing secret.");
				return;
			}
		} else {
			if (!secretValue.trim()) {
				setError("API key is required.");
				return;
			}
		}
		setError(null);
		try {
			const result = await quickMutation.mutateAsync({
				presetKey: preset.key,
				...(useExisting ? { secretKey: existingSecretKey } : { secretValue: secretValue.trim() }),
			});
			setSecretValue("");
			setSuccessKey(result.resolvedSecretKey);

			// Auto-test the connection
			const resolvedKey = useExisting ? existingSecretKey : result.resolvedSecretKey;
			const auth: ConnectorAuth =
				preset.defaults.auth.type === "custom_header"
					? {
							type: "custom_header",
							secretKey: resolvedKey,
							headerName: preset.defaults.auth.headerName,
						}
					: { type: "bearer", secretKey: resolvedKey };
			validateMutation.mutate({
				connector: {
					id: crypto.randomUUID(),
					name: preset.name,
					transport: "remote_http",
					url: preset.defaults.url,
					auth,
					riskPolicy: preset.defaults.riskPolicy ?? { defaultRisk: "write" },
					enabled: true,
				},
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create connector");
		}
	};

	if (successKey) {
		return (
			<div className="space-y-2">
				<div className="rounded-lg border border-green-600/30 bg-green-600/5 p-4">
					<div className="flex items-center gap-2">
						<Check className="h-4 w-4 text-green-600" />
						<span className="text-sm font-medium text-green-600">{preset.name} connected</span>
					</div>
					<p className="text-xs text-muted-foreground mt-1">
						Secret key: <code className="font-mono">{successKey}</code>
					</p>
				</div>
				{validateMutation.isPending && (
					<div className="rounded-md border border-border/80 bg-background p-3 flex items-center gap-2">
						<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						<span className="text-xs text-muted-foreground">Testing connection...</span>
					</div>
				)}
				{validateMutation.data && (
					<>
						<ValidationResult result={validateMutation.data} />
						<div className="flex justify-end">
							<Button variant="ghost" size="sm" onClick={onClose}>
								Done
							</Button>
						</div>
					</>
				)}
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border/80 bg-background p-4">
			<div className="flex items-center justify-between mb-3">
				<div className="flex items-center gap-2.5">
					<div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
						<ConnectorIcon presetKey={preset.key} size="sm" />
					</div>
					<div>
						<h4 className="text-sm font-medium">{preset.name}</h4>
						<p className="text-xs text-muted-foreground">{preset.description}</p>
					</div>
				</div>
				{preset.docsUrl && (
					<a
						href={preset.docsUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
					>
						Docs
						<ExternalLink className="h-3 w-3" />
					</a>
				)}
			</div>

			<div className="space-y-3">
				{/* Toggle: new key vs existing */}
				{secretOptions.length > 0 && (
					<div className="flex items-center gap-3 text-xs">
						<button
							type="button"
							className={`pb-0.5 ${!useExisting ? "text-foreground border-b border-foreground font-medium" : "text-muted-foreground"}`}
							onClick={() => setUseExisting(false)}
						>
							New API key
						</button>
						<button
							type="button"
							className={`pb-0.5 ${useExisting ? "text-foreground border-b border-foreground font-medium" : "text-muted-foreground"}`}
							onClick={() => setUseExisting(true)}
						>
							Use existing secret
						</button>
					</div>
				)}

				{useExisting ? (
					<div>
						<Label className="text-xs">Existing secret</Label>
						<Select value={existingSecretKey} onValueChange={setExistingSecretKey}>
							<SelectTrigger className="h-8 text-sm mt-1">
								<SelectValue placeholder="Select a secret..." />
							</SelectTrigger>
							<SelectContent>
								{secretOptions.map((s) => (
									<SelectItem key={s.key} value={s.key}>
										{s.key}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : (
					<div>
						<Label className="text-xs">{preset.secretLabel || "API key"}</Label>
						<Input
							type="password"
							value={secretValue}
							onChange={(e) => setSecretValue(e.target.value)}
							placeholder="Paste your API key"
							className="h-8 text-sm mt-1 font-mono"
							autoFocus
						/>
					</div>
				)}

				{/* Show defaults for transparency */}
				<div className="text-xs text-muted-foreground space-y-0.5">
					<p>
						<span className="text-muted-foreground/70">URL:</span> {preset.defaults.url}
					</p>
					<p>
						<span className="text-muted-foreground/70">Auth:</span>{" "}
						{preset.defaults.auth.type === "bearer"
							? "Bearer token"
							: `Custom header (${preset.defaults.auth.type === "custom_header" ? preset.defaults.auth.headerName : ""})`}
					</p>
					<p>
						<span className="text-muted-foreground/70">Risk:</span>{" "}
						{preset.defaults.riskPolicy?.defaultRisk ?? "write"}
					</p>
					{!useExisting && (
						<p>
							<span className="text-muted-foreground/70">Secret key:</span>{" "}
							{preset.recommendedSecretKey}
						</p>
					)}
				</div>

				{error && <p className="text-xs text-destructive">{error}</p>}

				<div className="flex items-center justify-end gap-2 pt-1">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setSecretValue("");
							onClose();
						}}
					>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSubmit} disabled={quickMutation.isPending}>
						{quickMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
						Add {preset.name}
					</Button>
				</div>
			</div>
		</div>
	);
}
