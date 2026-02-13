"use client";

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
import { useConnectors, useUpdateConnectors, useValidateConnector } from "@/hooks/use-connectors";
import { useSecrets } from "@/hooks/use-secrets";
import {
	CONNECTOR_PRESETS,
	type ConnectorAuth,
	type ConnectorConfig,
	type ConnectorPreset,
} from "@proliferate/shared";
import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronRight,
	Loader2,
	Pencil,
	Plug,
	Plus,
	Trash2,
	Unplug,
} from "lucide-react";
import { useCallback, useState } from "react";

// ============================================
// ConnectorsContent — main panel shown in Settings
// ============================================

export function ConnectorsContent({
	prebuildId,
}: {
	prebuildId?: string | null;
}) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [showAdd, setShowAdd] = useState(false);

	const { data: connectors, isLoading } = useConnectors(prebuildId ?? "", !!prebuildId);
	const updateMutation = useUpdateConnectors();

	if (!prebuildId) {
		return (
			<div className="p-4 text-center">
				<Unplug className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
				<p className="text-sm text-muted-foreground">
					Save a snapshot first to configure connectors
				</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="p-4 flex items-center justify-center">
				<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const currentConnectors = connectors ?? [];

	const handleRemove = (connectorId: string) => {
		const updated = currentConnectors.filter((c) => c.id !== connectorId);
		updateMutation.mutate({ prebuildId, connectors: updated });
	};

	const handleToggle = (connectorId: string) => {
		const updated = currentConnectors.map((c) =>
			c.id === connectorId ? { ...c, enabled: !c.enabled } : c,
		);
		updateMutation.mutate({ prebuildId, connectors: updated });
	};

	const handleSave = (connector: ConnectorConfig) => {
		const exists = currentConnectors.some((c) => c.id === connector.id);
		const updated = exists
			? currentConnectors.map((c) => (c.id === connector.id ? connector : c))
			: [...currentConnectors, connector];
		updateMutation.mutate({ prebuildId, connectors: updated });
		setEditingId(null);
		setShowAdd(false);
	};

	if (showAdd) {
		return (
			<div className="p-3 space-y-3">
				<PresetPicker
					onSelect={(preset) => {
						setShowAdd(false);
						setEditingId(`new:${preset.key}`);
					}}
					onCancel={() => setShowAdd(false)}
				/>
			</div>
		);
	}

	if (editingId) {
		const isNew = editingId.startsWith("new:");
		const presetKey = isNew ? editingId.slice(4) : null;
		const existing = isNew ? null : currentConnectors.find((c) => c.id === editingId);
		const preset = presetKey ? CONNECTOR_PRESETS.find((p) => p.key === presetKey) : null;

		return (
			<div className="p-3">
				<ConnectorForm
					prebuildId={prebuildId}
					initial={existing ?? undefined}
					preset={preset ?? undefined}
					onSave={handleSave}
					onCancel={() => setEditingId(null)}
				/>
			</div>
		);
	}

	return (
		<div className="p-3 space-y-3">
			{currentConnectors.length === 0 ? (
				<EmptyState onAdd={() => setShowAdd(true)} />
			) : (
				<>
					<div className="space-y-2">
						{currentConnectors.map((connector) => (
							<ConnectorRow
								key={connector.id}
								connector={connector}
								onEdit={() => setEditingId(connector.id)}
								onRemove={() => handleRemove(connector.id)}
								onToggle={() => handleToggle(connector.id)}
							/>
						))}
					</div>
					{currentConnectors.length < 20 && (
						<Button variant="outline" size="sm" className="w-full" onClick={() => setShowAdd(true)}>
							<Plus className="h-3.5 w-3.5 mr-2" />
							Add connector
						</Button>
					)}
				</>
			)}
		</div>
	);
}

// ============================================
// Sub-components
// ============================================

function EmptyState({ onAdd }: { onAdd: () => void }) {
	return (
		<div className="text-center py-6">
			<Plug className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
			<p className="text-sm text-muted-foreground mb-1">No connectors configured</p>
			<p className="text-xs text-muted-foreground mb-3">
				Connect remote MCP servers to give the agent access to external tools
			</p>
			<Button variant="outline" size="sm" onClick={onAdd}>
				<Plus className="h-3.5 w-3.5 mr-2" />
				Add connector
			</Button>
		</div>
	);
}

function ConnectorRow({
	connector,
	onEdit,
	onRemove,
	onToggle,
}: {
	connector: ConnectorConfig;
	onEdit: () => void;
	onRemove: () => void;
	onToggle: () => void;
}) {
	return (
		<div className="rounded-md border border-border/60 p-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 min-w-0 flex-1">
					<Plug
						className={`h-3.5 w-3.5 shrink-0 ${connector.enabled ? "text-primary" : "text-muted-foreground"}`}
					/>
					<span className="text-sm font-medium truncate">{connector.name}</span>
					{!connector.enabled && (
						<span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
							disabled
						</span>
					)}
				</div>
				<div className="flex items-center gap-1 shrink-0">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 w-7 p-0"
						onClick={onToggle}
						title={connector.enabled ? "Disable" : "Enable"}
					>
						{connector.enabled ? (
							<Check className="h-3.5 w-3.5 text-primary" />
						) : (
							<Unplug className="h-3.5 w-3.5 text-muted-foreground" />
						)}
					</Button>
					<Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}>
						<Pencil className="h-3.5 w-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
						onClick={onRemove}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
			<p className="text-xs text-muted-foreground mt-1 truncate">{connector.url}</p>
		</div>
	);
}

function PresetPicker({
	onSelect,
	onCancel,
}: {
	onSelect: (preset: ConnectorPreset) => void;
	onCancel: () => void;
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm font-medium">Choose a connector type</span>
				<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
					Cancel
				</Button>
			</div>
			{CONNECTOR_PRESETS.map((preset) => (
				<button
					key={preset.key}
					type="button"
					className="w-full text-left rounded-md border border-border/60 p-3 hover:bg-muted/30 transition-colors"
					onClick={() => onSelect(preset)}
				>
					<span className="text-sm font-medium">{preset.name}</span>
					<p className="text-xs text-muted-foreground mt-0.5">{preset.description}</p>
				</button>
			))}
		</div>
	);
}

function ConnectorForm({
	prebuildId,
	initial,
	preset,
	onSave,
	onCancel,
}: {
	prebuildId: string;
	initial?: ConnectorConfig;
	preset?: ConnectorPreset;
	onSave: (connector: ConnectorConfig) => void;
	onCancel: () => void;
}) {
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
		(initial?.auth.type === "custom_header" ? initial.auth.headerName : null) ??
			(defaults?.auth.type === "custom_header" ? defaults.auth.headerName : null) ??
			"",
	);
	const [defaultRisk, setDefaultRisk] = useState(
		initial?.riskPolicy?.defaultRisk ?? defaults?.riskPolicy?.defaultRisk ?? "write",
	);
	const [enabled, setEnabled] = useState(initial?.enabled ?? defaults?.enabled ?? true);

	const { data: orgSecrets } = useSecrets();
	const validateMutation = useValidateConnector();
	const [validationResult, setValidationResult] = useState<{
		ok: boolean;
		tools: Array<{ name: string; description: string; riskLevel: string }>;
		error: string | null;
		diagnostics: { class: string; message: string } | null;
	} | null>(null);

	const connectorId = initial?.id ?? crypto.randomUUID();

	const buildConnector = useCallback((): ConnectorConfig => {
		const auth: ConnectorAuth =
			authType === "custom_header"
				? { type: "custom_header", secretKey, headerName }
				: { type: "bearer", secretKey };

		return {
			id: connectorId,
			name,
			transport: "remote_http",
			url,
			auth,
			riskPolicy: { defaultRisk },
			enabled,
		};
	}, [connectorId, name, url, authType, secretKey, headerName, defaultRisk, enabled]);

	const handleValidate = async () => {
		setValidationResult(null);
		const connector = buildConnector();
		try {
			const result = await validateMutation.mutateAsync({
				prebuildId,
				connector,
			});
			setValidationResult(result);
		} catch {
			setValidationResult({
				ok: false,
				tools: [],
				error: "Validation request failed",
				diagnostics: { class: "unknown", message: "Network or server error" },
			});
		}
	};

	const canSave = name.trim() && url.trim() && secretKey.trim();
	const canValidate = url.trim() && secretKey.trim();

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<span className="text-sm font-medium">{initial ? "Edit connector" : "Add connector"}</span>
			</div>

			{preset?.guidance && (
				<div className="rounded-md bg-muted/50 border border-border/40 p-2.5">
					<p className="text-xs text-muted-foreground">{preset.guidance}</p>
				</div>
			)}

			<div className="space-y-2">
				<div>
					<Label className="text-xs">Name</Label>
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. Context7"
						className="h-8 text-sm mt-1"
					/>
				</div>

				<div>
					<Label className="text-xs">MCP Server URL</Label>
					<Input
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="https://mcp.example.com/mcp"
						className="h-8 text-sm font-mono mt-1"
					/>
				</div>

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

				{authType === "custom_header" && (
					<div>
						<Label className="text-xs">Header name</Label>
						<Input
							value={headerName}
							onChange={(e) => setHeaderName(e.target.value)}
							placeholder="e.g. X-Api-Key"
							className="h-8 text-sm mt-1"
						/>
					</div>
				)}

				<div>
					<Label className="text-xs">Secret key</Label>
					{orgSecrets && orgSecrets.length > 0 ? (
						<Select value={secretKey} onValueChange={setSecretKey}>
							<SelectTrigger className="h-8 text-sm mt-1">
								<SelectValue placeholder="Select a secret..." />
							</SelectTrigger>
							<SelectContent>
								{orgSecrets.map((s) => (
									<SelectItem key={s.id} value={s.key} className="text-sm">
										{s.key}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<Input
							value={secretKey}
							onChange={(e) => setSecretKey(e.target.value)}
							placeholder="Secret key name from org secrets"
							className="h-8 text-sm mt-1"
						/>
					)}
					<p className="text-[10px] text-muted-foreground mt-0.5">
						References a secret by key name (not the value itself)
					</p>
				</div>

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

			{/* Validation results */}
			{validationResult && <ValidationResult result={validationResult} />}

			{/* Actions */}
			<div className="flex items-center gap-2 pt-1">
				<Button
					variant="outline"
					size="sm"
					className="h-7 text-xs"
					onClick={handleValidate}
					disabled={!canValidate || validateMutation.isPending}
				>
					{validateMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
					Validate
				</Button>
				<div className="flex-1" />
				<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					size="sm"
					className="h-7 text-xs"
					onClick={() => onSave(buildConnector())}
					disabled={!canSave}
				>
					{initial ? "Save" : "Add"}
				</Button>
			</div>
		</div>
	);
}

function ValidationResult({
	result,
}: {
	result: {
		ok: boolean;
		tools: Array<{ name: string; description: string; riskLevel: string }>;
		error: string | null;
		diagnostics: { class: string; message: string } | null;
	};
}) {
	const [expanded, setExpanded] = useState(false);

	if (result.ok) {
		return (
			<div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
				<div className="flex items-center gap-2">
					<Check className="h-3.5 w-3.5 text-emerald-500" />
					<span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
						Connected — {result.tools.length} tool{result.tools.length !== 1 ? "s" : ""} discovered
					</span>
					<button
						type="button"
						className="ml-auto text-muted-foreground"
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
					</button>
				</div>
				{expanded && (
					<div className="mt-2 space-y-1">
						{result.tools.map((tool) => (
							<div key={tool.name} className="flex items-center gap-2 text-xs">
								<span className="font-mono truncate flex-1">{tool.name}</span>
								<span
									className={`px-1 py-0.5 rounded text-[10px] ${
										tool.riskLevel === "read"
											? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
											: tool.riskLevel === "danger"
												? "bg-destructive/10 text-destructive"
												: "bg-amber-500/10 text-amber-600 dark:text-amber-400"
									}`}
								>
									{tool.riskLevel}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
			<div className="flex items-start gap-2">
				<AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
				<div className="min-w-0">
					<span className="text-xs font-medium text-destructive">
						Validation failed
						{result.diagnostics ? ` (${result.diagnostics.class})` : ""}
					</span>
					<p className="text-xs text-muted-foreground mt-0.5 break-all">{result.error}</p>
				</div>
			</div>
		</div>
	);
}
