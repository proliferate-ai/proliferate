"use client";

import { SettingsCard, SettingsSection } from "@/components/settings/settings-row";
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
	useCreateOrgConnector,
	useDeleteOrgConnector,
	useOrgConnectors,
	useUpdateOrgConnector,
	useValidateOrgConnector,
} from "@/hooks/use-org-connectors";
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
// Main Page
// ============================================

export default function ConnectorsPage() {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [showAdd, setShowAdd] = useState(false);

	const { data: connectors, isLoading } = useOrgConnectors();
	const createMutation = useCreateOrgConnector();
	const updateMutation = useUpdateOrgConnector();
	const deleteMutation = useDeleteOrgConnector();

	const handleRemove = useCallback(
		async (id: string) => {
			await deleteMutation.mutateAsync({ id });
		},
		[deleteMutation],
	);

	const handleToggle = useCallback(
		async (connector: ConnectorConfig) => {
			await updateMutation.mutateAsync({
				id: connector.id,
				enabled: !connector.enabled,
			});
		},
		[updateMutation],
	);

	const handleSave = useCallback(
		async (connector: ConnectorConfig, isNew: boolean) => {
			if (isNew) {
				await createMutation.mutateAsync({
					name: connector.name,
					transport: connector.transport,
					url: connector.url,
					auth: connector.auth,
					riskPolicy: connector.riskPolicy,
					enabled: connector.enabled,
				});
			} else {
				await updateMutation.mutateAsync({
					id: connector.id,
					name: connector.name,
					url: connector.url,
					auth: connector.auth,
					riskPolicy: connector.riskPolicy,
					enabled: connector.enabled,
				});
			}
			setEditingId(null);
			setShowAdd(false);
		},
		[createMutation, updateMutation],
	);

	if (isLoading) {
		return (
			<SettingsSection title="Connectors">
				<SettingsCard>
					<div className="p-6 flex justify-center">
						<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					</div>
				</SettingsCard>
			</SettingsSection>
		);
	}

	const list = connectors ?? [];

	return (
		<SettingsSection title="Connectors">
			<p className="text-sm text-muted-foreground -mt-1 mb-2">
				Connect remote MCP servers to give your agents access to external tools. All sessions in
				this organization share these connectors.
			</p>
			<SettingsCard>
				{list.length === 0 && !showAdd ? (
					<EmptyState onAdd={() => setShowAdd(true)} />
				) : (
					<div className="divide-y divide-border">
						{list.map((c) =>
							editingId === c.id ? (
								<ConnectorForm
									key={c.id}
									initial={c}
									isNew={false}
									onSave={handleSave}
									onCancel={() => setEditingId(null)}
								/>
							) : (
								<ConnectorRow
									key={c.id}
									connector={c}
									onEdit={() => setEditingId(c.id)}
									onRemove={() => handleRemove(c.id)}
									onToggle={() => handleToggle(c)}
								/>
							),
						)}
						{showAdd && (
							<ConnectorForm isNew onSave={handleSave} onCancel={() => setShowAdd(false)} />
						)}
					</div>
				)}
				{list.length > 0 && !showAdd && !editingId && (
					<div className="p-3 border-t border-border">
						<Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
							<Plus className="h-3.5 w-3.5 mr-1.5" />
							Add connector
						</Button>
					</div>
				)}
			</SettingsCard>
		</SettingsSection>
	);
}

// ============================================
// EmptyState
// ============================================

function EmptyState({ onAdd }: { onAdd: () => void }) {
	return (
		<div className="p-8 text-center">
			<Unplug className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
			<p className="text-sm font-medium mb-1">No connectors configured</p>
			<p className="text-xs text-muted-foreground mb-4">
				Add a remote MCP server to extend your agents with external tools.
			</p>
			<Button variant="outline" size="sm" onClick={onAdd}>
				<Plus className="h-3.5 w-3.5 mr-1.5" />
				Add connector
			</Button>
		</div>
	);
}

// ============================================
// ConnectorRow
// ============================================

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
	const [confirmDelete, setConfirmDelete] = useState(false);

	return (
		<div className="flex items-center justify-between px-4 py-3">
			<div className="flex items-center gap-3 min-w-0">
				<Plug className="h-4 w-4 text-muted-foreground shrink-0" />
				<div className="min-w-0">
					<p className="text-sm font-medium truncate">{connector.name}</p>
					<p className="text-xs text-muted-foreground truncate">{connector.url}</p>
				</div>
			</div>

			<div className="flex items-center gap-1.5 shrink-0">
				<Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onToggle}>
					{connector.enabled ? (
						<span className="text-green-600">Enabled</span>
					) : (
						<span className="text-muted-foreground">Disabled</span>
					)}
				</Button>
				<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
					<Pencil className="h-3.5 w-3.5" />
				</Button>
				{confirmDelete ? (
					<Button
						variant="destructive"
						size="sm"
						className="h-7 px-2 text-xs"
						onClick={() => {
							onRemove();
							setConfirmDelete(false);
						}}
					>
						Confirm
					</Button>
				) : (
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-destructive"
						onClick={() => setConfirmDelete(true)}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
				)}
			</div>
		</div>
	);
}

// ============================================
// PresetPicker
// ============================================

function PresetPicker({ onSelect }: { onSelect: (preset: ConnectorPreset) => void }) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="mb-4">
			<button
				type="button"
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				onClick={() => setExpanded(!expanded)}
			>
				{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				Start from a preset
			</button>
			{expanded && (
				<div className="mt-2 grid grid-cols-2 gap-2">
					{CONNECTOR_PRESETS.map((p) => (
						<button
							key={p.key}
							type="button"
							className="text-left p-2 rounded-md border border-border hover:bg-muted/50 transition-colors"
							onClick={() => onSelect(p)}
						>
							<p className="text-xs font-medium">{p.name}</p>
							<p className="text-[11px] text-muted-foreground">{p.description}</p>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// ============================================
// ConnectorForm
// ============================================

function ConnectorForm({
	initial,
	isNew,
	onSave,
	onCancel,
}: {
	initial?: ConnectorConfig;
	isNew: boolean;
	onSave: (connector: ConnectorConfig, isNew: boolean) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(initial?.name ?? "");
	const [url, setUrl] = useState(initial?.url ?? "");
	const [authType, setAuthType] = useState<"bearer" | "custom_header">(
		initial?.auth.type ?? "bearer",
	);
	const [secretKey, setSecretKey] = useState(initial?.auth.secretKey ?? "");
	const [headerName, setHeaderName] = useState(
		initial?.auth.type === "custom_header" ? initial.auth.headerName : "",
	);
	const [defaultRisk, setDefaultRisk] = useState<"read" | "write" | "danger">(
		initial?.riskPolicy?.defaultRisk ?? "write",
	);
	const [enabled, setEnabled] = useState(initial?.enabled ?? true);
	const [guidance, setGuidance] = useState<string | null>(null);
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

	const handlePreset = (preset: ConnectorPreset) => {
		setName(preset.defaults.name);
		setUrl(preset.defaults.url);
		setAuthType(preset.defaults.auth.type);
		setSecretKey(preset.defaults.auth.secretKey);
		if (preset.defaults.auth.type === "custom_header") {
			setHeaderName(preset.defaults.auth.headerName);
		}
		setDefaultRisk(preset.defaults.riskPolicy?.defaultRisk ?? "write");
		setEnabled(preset.defaults.enabled);
		setGuidance(preset.guidance ?? null);
	};

	const handleValidate = () => {
		setSaveError(null);
		validateMutation.mutate({ connector: buildConnector() });
	};

	const handleSave = () => {
		if (!name.trim() || !url.trim() || !secretKey.trim()) {
			setSaveError("Name, URL, and secret are required.");
			return;
		}
		setSaveError(null);
		onSave(buildConnector(), isNew);
	};

	const canValidate = !!url.trim() && !!secretKey.trim();

	return (
		<div className="p-4 space-y-4">
			{isNew && <PresetPicker onSelect={handlePreset} />}

			{guidance && (
				<div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">{guidance}</div>
			)}

			<div className="grid grid-cols-2 gap-3">
				<div>
					<Label className="text-xs">Name</Label>
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. Notion"
						className="h-8 text-sm mt-1"
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
					<Button size="sm" onClick={handleSave}>
						{isNew ? "Add" : "Save"}
					</Button>
				</div>
			</div>
		</div>
	);
}

// ============================================
// ValidationResult
// ============================================

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
	if (result.ok) {
		return (
			<div className="rounded-md border border-green-600/30 bg-green-600/5 p-3">
				<div className="flex items-center gap-2 mb-2">
					<Check className="h-4 w-4 text-green-600" />
					<span className="text-xs font-medium text-green-600">
						Connected — {result.tools.length} tool{result.tools.length !== 1 ? "s" : ""} discovered
					</span>
				</div>
				<div className="space-y-1">
					{result.tools.map((t) => (
						<div key={t.name} className="flex items-center justify-between text-xs">
							<span className="text-foreground">{t.name}</span>
							<span className="text-muted-foreground">{t.riskLevel}</span>
						</div>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
			<div className="flex items-center gap-2 mb-1">
				<AlertTriangle className="h-4 w-4 text-destructive" />
				<span className="text-xs font-medium text-destructive">
					{result.diagnostics?.class === "auth"
						? "Authentication failed"
						: result.diagnostics?.class === "timeout"
							? "Connection timed out"
							: result.diagnostics?.class === "unreachable"
								? "Server unreachable"
								: result.diagnostics?.class === "protocol"
									? "Protocol error"
									: "Connection failed"}
				</span>
			</div>
			{result.error && (
				<p className="text-xs text-muted-foreground mt-1 break-all">{result.error}</p>
			)}
		</div>
	);
}
