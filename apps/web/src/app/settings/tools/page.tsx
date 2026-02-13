"use client";

import { ConnectorIcon } from "@/components/integrations/connector-icon";
import { ProviderIcon } from "@/components/integrations/provider-icon";
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
import { useIntegrations } from "@/hooks/use-integrations";
import { useNangoConnect } from "@/hooks/use-nango-connect";
import {
	useCreateOrgConnector,
	useCreateOrgConnectorWithSecret,
	useDeleteOrgConnector,
	useOrgConnectors,
	useUpdateOrgConnector,
	useValidateOrgConnector,
} from "@/hooks/use-org-connectors";
import { useSecrets } from "@/hooks/use-secrets";
import { ACTION_ADAPTERS, type AdapterMeta } from "@/lib/action-adapters";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { env } from "@proliferate/environment/public";
import {
	CONNECTOR_PRESETS,
	type ConnectorAuth,
	type ConnectorConfig,
	type ConnectorPreset,
} from "@proliferate/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	ChevronRight,
	ExternalLink,
	Loader2,
	Pencil,
	Plug,
	Trash2,
	Unplug,
} from "lucide-react";
import { useCallback, useState } from "react";

// ============================================
// Preset categorization
// ============================================

const quickPresets = CONNECTOR_PRESETS.filter((p) => p.quickSetup);
const advancedPresets = CONNECTOR_PRESETS.filter((p) => !p.quickSetup);

/** Best-effort preset key lookup for a connected tool (matches by URL). */
function findPresetKey(connector: ConnectorConfig): string {
	const match = CONNECTOR_PRESETS.find((p) => p.defaults.url && connector.url === p.defaults.url);
	return match?.key ?? "custom";
}

// ============================================
// AdapterCard (built-in integrations)
// ============================================

function AdapterCard({
	adapter,
	isConnected,
	isLoading,
	onConnect,
	onDisconnect,
}: {
	adapter: AdapterMeta;
	isConnected: boolean;
	isLoading: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [confirmDisconnect, setConfirmDisconnect] = useState(false);
	const readCount = adapter.actions.filter((a) => a.riskLevel === "read").length;
	const writeCount = adapter.actions.filter((a) => a.riskLevel === "write").length;

	return (
		<div className="rounded-lg border border-border/80 bg-background">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3">
				<div className="flex items-center gap-3 min-w-0">
					<div className="flex items-center justify-center h-8 w-8 rounded-md bg-muted shrink-0">
						<ProviderIcon provider={adapter.integration} size="sm" />
					</div>
					<div className="min-w-0">
						<p className="text-sm font-medium">{adapter.displayName}</p>
						<p className="text-xs text-muted-foreground">{adapter.description}</p>
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{isConnected ? (
						<>
							<span className="text-xs text-green-600">Connected</span>
							{confirmDisconnect ? (
								<div className="flex items-center gap-1">
									<Button
										variant="destructive"
										size="sm"
										className="h-7 px-2 text-xs"
										onClick={() => {
											onDisconnect();
											setConfirmDisconnect(false);
										}}
										disabled={isLoading}
									>
										Confirm
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 px-2 text-xs"
										onClick={() => setConfirmDisconnect(false)}
									>
										Cancel
									</Button>
								</div>
							) : (
								<Button
									variant="ghost"
									size="sm"
									className="h-7 px-2 text-xs text-muted-foreground"
									onClick={() => setConfirmDisconnect(true)}
									disabled={isLoading}
								>
									Disconnect
								</Button>
							)}
						</>
					) : (
						<Button
							variant="outline"
							size="sm"
							className="h-7 px-3 text-xs"
							onClick={onConnect}
							disabled={isLoading}
						>
							{isLoading && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
							Connect
						</Button>
					)}
				</div>
			</div>

			{/* Action summary + expand toggle */}
			<button
				type="button"
				className="flex items-center gap-2 px-4 py-2 w-full border-t border-border/60 text-xs text-muted-foreground hover:text-foreground transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
				<ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
				<span>
					{adapter.actions.length} actions ({readCount} read, {writeCount} write)
				</span>
			</button>

			{/* Expanded action list */}
			{expanded && (
				<div className="border-t border-border/60 px-4 py-2 space-y-1">
					{adapter.actions.map((action) => (
						<div key={action.name} className="flex items-center justify-between py-1">
							<div className="flex items-center gap-2 min-w-0">
								<span className="text-xs font-mono text-foreground">{action.name}</span>
								<span className="text-xs text-muted-foreground truncate">{action.description}</span>
							</div>
							<span
								className={cn(
									"text-[10px] px-1.5 py-0.5 rounded border shrink-0",
									action.riskLevel === "read"
										? "text-green-600 border-green-600/30"
										: "text-amber-600 border-amber-600/30",
								)}
							>
								{action.riskLevel}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ============================================
// Main Page
// ============================================

export default function ConnectorsPage() {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [advancedPreset, setAdvancedPreset] = useState<ConnectorPreset | null>(null);
	const [quickSetupPreset, setQuickSetupPreset] = useState<ConnectorPreset | null>(null);

	const { data: connectors, isLoading } = useOrgConnectors();
	const createMutation = useCreateOrgConnector();
	const updateMutation = useUpdateOrgConnector();
	const deleteMutation = useDeleteOrgConnector();

	// Integrations (action adapters)
	const integrationsEnabled = env.NEXT_PUBLIC_INTEGRATIONS_ENABLED;
	const { data: integrationsData } = useIntegrations();
	const queryClient = useQueryClient();
	const {
		connect: nangoConnect,
		disconnect: nangoDisconnect,
		loadingProvider: nangoLoadingProvider,
	} = useNangoConnect({
		flow: "connectUI",
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
		},
	});

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
			setAdvancedPreset(null);
		},
		[createMutation, updateMutation],
	);

	if (isLoading) {
		return (
			<SettingsSection title="Tools">
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
		<div className="space-y-6">
			{/* Section 0: Built-in integrations (action adapters) */}
			{integrationsEnabled && (
				<SettingsSection title="Integrations">
					<p className="text-sm text-muted-foreground -mt-1 mb-3">
						OAuth-connected services that provide built-in actions to your agents.
					</p>
					<div className="space-y-2">
						{ACTION_ADAPTERS.map((adapter) => {
							const providerIntegrations = integrationsData?.byProvider[adapter.integration] ?? [];
							const activeIntegration = providerIntegrations.find((i) => i.status === "active");
							return (
								<AdapterCard
									key={adapter.integration}
									adapter={adapter}
									isConnected={!!activeIntegration}
									isLoading={nangoLoadingProvider === adapter.integration}
									onConnect={() => nangoConnect(adapter.integration)}
									onDisconnect={() => {
										if (activeIntegration) {
											nangoDisconnect(adapter.integration, activeIntegration.id);
										}
									}}
								/>
							);
						})}
					</div>
				</SettingsSection>
			)}

			{/* Section 1: Add a tool */}
			<SettingsSection title="Add a tool">
				<p className="text-sm text-muted-foreground -mt-1 mb-3">
					Connect remote MCP servers to give your agents access to external tools.
				</p>

				{/* Quick-setup preset grid */}
				<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
					{quickPresets.map((preset) => (
						<button
							key={preset.key}
							type="button"
							className="text-left p-3 rounded-lg border border-border hover:border-foreground/20 hover:bg-muted/50 transition-colors"
							onClick={() => {
								setQuickSetupPreset(preset);
								setAdvancedPreset(null);
							}}
						>
							<div className="flex items-center gap-2.5 mb-1">
								<div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted shrink-0">
									<ConnectorIcon presetKey={preset.key} size="sm" />
								</div>
								<p className="text-sm font-medium">{preset.name}</p>
							</div>
							<p className="text-xs text-muted-foreground line-clamp-2">{preset.description}</p>
						</button>
					))}

					{/* Advanced presets */}
					{advancedPresets.map((preset) => (
						<button
							key={preset.key}
							type="button"
							className="text-left p-3 rounded-lg border border-dashed border-border hover:border-foreground/20 hover:bg-muted/50 transition-colors"
							onClick={() => {
								setAdvancedPreset(preset);
								setQuickSetupPreset(null);
							}}
						>
							<div className="flex items-center gap-2.5 mb-1">
								<div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted shrink-0">
									<ConnectorIcon presetKey={preset.key} size="sm" />
								</div>
								<p className="text-sm font-medium">{preset.name}</p>
							</div>
							<p className="text-xs text-muted-foreground line-clamp-2">{preset.description}</p>
						</button>
					))}
				</div>

				{/* Quick-setup inline form */}
				{quickSetupPreset && (
					<div className="mt-3">
						<QuickSetupForm preset={quickSetupPreset} onClose={() => setQuickSetupPreset(null)} />
					</div>
				)}

				{/* Advanced add form */}
				{advancedPreset && !quickSetupPreset && (
					<div className="mt-3">
						<SettingsCard>
							<ConnectorForm
								isNew
								preset={advancedPreset}
								onSave={handleSave}
								onCancel={() => setAdvancedPreset(null)}
							/>
						</SettingsCard>
					</div>
				)}
			</SettingsSection>

			{/* Section 2: Connected connectors */}
			<SettingsSection title="Connected">
				{list.length === 0 ? (
					<div className="rounded-lg border border-border/80 bg-background p-6 text-center">
						<Unplug className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
						<p className="text-sm text-muted-foreground">
							No tools configured yet. Add one above to get started.
						</p>
					</div>
				) : (
					<SettingsCard>
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
						</div>
					</SettingsCard>
				)}
			</SettingsSection>
		</div>
	);
}

// ============================================
// QuickSetupForm
// ============================================

function QuickSetupForm({
	preset,
	onClose,
}: {
	preset: ConnectorPreset;
	onClose: () => void;
}) {
	const [useExisting, setUseExisting] = useState(false);
	const [secretValue, setSecretValue] = useState("");
	const [existingSecretKey, setExistingSecretKey] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [successKey, setSuccessKey] = useState<string | null>(null);
	const quickMutation = useCreateOrgConnectorWithSecret();
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
			setTimeout(onClose, 1500);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create connector");
		}
	};

	if (successKey) {
		return (
			<div className="rounded-lg border border-green-600/30 bg-green-600/5 p-4">
				<div className="flex items-center gap-2">
					<Check className="h-4 w-4 text-green-600" />
					<span className="text-sm font-medium text-green-600">{preset.name} connected</span>
				</div>
				<p className="text-xs text-muted-foreground mt-1">
					Secret key: <code className="font-mono">{successKey}</code>
				</p>
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
				<div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted shrink-0">
					<ConnectorIcon presetKey={findPresetKey(connector)} size="sm" />
				</div>
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
// ConnectorForm (Advanced)
// ============================================

function ConnectorForm({
	initial,
	isNew,
	preset,
	onSave,
	onCancel,
}: {
	initial?: ConnectorConfig;
	isNew: boolean;
	preset?: ConnectorPreset;
	onSave: (connector: ConnectorConfig, isNew: boolean) => void;
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
