"use client";

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
import { useValidateOrgConnector } from "@/hooks/use-org-connectors";
import { useSecrets } from "@/hooks/use-secrets";
import type { ConnectorAuth, ConnectorConfig, ConnectorPreset } from "@proliferate/shared";
import { Loader2, Plug } from "lucide-react";
import { useCallback, useState } from "react";

export interface ConnectorFormProps {
	initial?: ConnectorConfig;
	isNew: boolean;
	preset?: ConnectorPreset;
	onSave: (connector: ConnectorConfig, isNew: boolean) => void;
	onCancel: () => void;
}

export function ConnectorForm({ initial, isNew, preset, onSave, onCancel }: ConnectorFormProps) {
	const defaults = preset?.defaults;
	const [name, setName] = useState(initial?.name ?? defaults?.name ?? "");
	const [url, setUrl] = useState(initial?.url ?? defaults?.url ?? "");
	const [authType, setAuthType] = useState<"bearer" | "custom_header">(
		initial?.auth.type ?? defaults?.auth.type ?? "bearer",
	);
	const [secretKey, setSecretKey] = useState(
		initial?.auth.secretKey ?? defaults?.auth.secretKey ?? "",
	);
	const [headerName, setHeaderName] = useState(
		initial?.auth.type === "custom_header"
			? initial.auth.headerName
			: defaults?.auth.type === "custom_header"
				? defaults.auth.headerName
				: "",
	);
	const [defaultRisk, setDefaultRisk] = useState<"read" | "write" | "danger">(
		initial?.riskPolicy?.defaultRisk ?? defaults?.riskPolicy?.defaultRisk ?? "write",
	);
	const [enabled, setEnabled] = useState(initial?.enabled ?? defaults?.enabled ?? true);
	const [saveError, setSaveError] = useState<string | null>(null);

	const validateMutation = useValidateOrgConnector();
	const { data: orgSecrets } = useSecrets();
	const secretOptions = orgSecrets ?? [];
	const hasListedSecret = secretOptions.some((s) => s.key === secretKey);

	const buildAuth = useCallback((): ConnectorAuth => {
		if (authType === "custom_header") {
			return { type: "custom_header", secretKey, headerName: headerName || "X-Api-Key" };
		}
		return { type: "bearer", secretKey };
	}, [authType, secretKey, headerName]);

	const buildConnector = useCallback((): ConnectorConfig => {
		return {
			id: initial?.id ?? crypto.randomUUID(),
			name,
			transport: "remote_http",
			url,
			auth: buildAuth(),
			riskPolicy: { defaultRisk },
			enabled,
		};
	}, [initial, name, url, buildAuth, defaultRisk, enabled]);

	const handleValidate = () => {
		setSaveError(null);
		validateMutation.mutate({ connector: buildConnector() });
	};

	const handleSave = async () => {
		if (!name.trim() || !url.trim() || !secretKey.trim()) {
			setSaveError("Name, URL, and secret are required.");
			return;
		}
		setSaveError(null);
		const connector = buildConnector();
		const result = await validateMutation.mutateAsync({ connector });
		if (!result.ok) return;
		onSave(connector, isNew);
	};

	const canValidate = !!url.trim() && !!secretKey.trim();

	return (
		<div className="p-4 space-y-4">
			{preset?.guidance && (
				<div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
					{preset.guidance}
				</div>
			)}

			<div className="grid grid-cols-2 gap-3">
				<div>
					<Label className="text-xs">Name</Label>
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. Notion"
						className="h-8 text-sm mt-1"
						autoFocus
					/>
				</div>
				<div>
					<Label className="text-xs">URL</Label>
					<Input
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="https://mcp.example.com/mcp"
						className="h-8 text-sm mt-1"
					/>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div>
					<Label className="text-xs">Auth type</Label>
					<Select
						value={authType}
						onValueChange={(v) => setAuthType(v as "bearer" | "custom_header")}
					>
						<SelectTrigger className="h-8 text-sm mt-1">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="bearer">Bearer token</SelectItem>
							<SelectItem value="custom_header">Custom header</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div>
					<Label className="text-xs">Secret</Label>
					<Select
						value={hasListedSecret ? secretKey : "__custom"}
						onValueChange={(value) => {
							if (value !== "__custom") setSecretKey(value);
						}}
					>
						<SelectTrigger className="h-8 text-sm mt-1">
							<SelectValue placeholder="Select a secret..." />
						</SelectTrigger>
						<SelectContent>
							{secretOptions.map((s) => (
								<SelectItem key={s.key} value={s.key}>
									{s.key}
								</SelectItem>
							))}
							<SelectItem value="__custom">Custom secret key</SelectItem>
						</SelectContent>
					</Select>
					<Input
						value={secretKey}
						onChange={(e) => setSecretKey(e.target.value)}
						placeholder="Type or paste secret key name"
						className="h-8 text-sm mt-2"
					/>
				</div>
			</div>

			{authType === "custom_header" && (
				<div>
					<Label className="text-xs">Header name</Label>
					<Input
						value={headerName}
						onChange={(e) => setHeaderName(e.target.value)}
						placeholder="X-Api-Key"
						className="h-8 text-sm mt-1"
					/>
				</div>
			)}

			<div className="grid grid-cols-2 gap-3">
				<div>
					<Label className="text-xs">Default risk level</Label>
					<Select
						value={defaultRisk}
						onValueChange={(v) => setDefaultRisk(v as "read" | "write" | "danger")}
					>
						<SelectTrigger className="h-8 text-sm mt-1">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="read">Read (auto-approved)</SelectItem>
							<SelectItem value="write">Write (requires approval)</SelectItem>
							<SelectItem value="danger">Danger (always denied)</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			{/* Validation */}
			{validateMutation.data && <ValidationResult result={validateMutation.data} />}
			{saveError && <p className="text-xs text-destructive">{saveError}</p>}

			<div className="flex items-center justify-between pt-2">
				<Button
					variant="outline"
					size="sm"
					onClick={handleValidate}
					disabled={!canValidate || validateMutation.isPending}
				>
					{validateMutation.isPending ? (
						<Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
					) : (
						<Plug className="h-3.5 w-3.5 mr-1.5" />
					)}
					Test connection
				</Button>
				<div className="flex gap-2">
					<Button variant="ghost" size="sm" onClick={onCancel}>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSave} disabled={validateMutation.isPending}>
						{validateMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
						{isNew ? "Test & Add" : "Test & Save"}
					</Button>
				</div>
			</div>
		</div>
	);
}
