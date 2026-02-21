"use client";

import { SecretFilesEditor } from "@/components/repositories/secret-files-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useConfiguration, useConfigurationEnvFiles } from "@/hooks/use-configurations";
import { useCheckSecrets } from "@/hooks/use-repos";
import { useCreateSecret, useDeleteSecret, useSecrets } from "@/hooks/use-secrets";
import { orpc } from "@/lib/orpc";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileLock2, FileUp, Loader2, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PanelShell } from "./panel-shell";

// ============================================
// Types
// ============================================

interface EnvFileSpec {
	workspacePath?: string;
	path: string;
	format?: string;
	mode?: string;
	keys: Array<{ key: string; required?: boolean }>;
}

interface EnvironmentPanelProps {
	sessionId: string;
	configurationId?: string | null;
	repoId?: string | null;
	isSetupSession?: boolean;
	workspaceOptions?: Array<{ workspacePath: string; label: string }>;
}

// ============================================
// Parse .env text into key-value pairs
// ============================================

function parseEnvText(text: string): Array<{ key: string; value: string }> {
	const results: Array<{ key: string; value: string }> = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIndex = trimmed.indexOf("=");
		if (eqIndex === -1) continue;
		const key = trimmed.slice(0, eqIndex).trim();
		let value = trimmed.slice(eqIndex + 1).trim();
		// Strip surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (key) results.push({ key, value });
	}
	return results;
}

// ============================================
// Add Variable Form (always visible)
// ============================================

function AddVariableForm({
	sessionId,
	configurationId,
	onSaved,
}: {
	sessionId: string;
	configurationId?: string | null;
	onSaved: () => void;
}) {
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");
	const [persist, setPersist] = useState(true);
	const [saving, setSaving] = useState(false);

	const createSecret = useCreateSecret();
	const submitEnv = useMutation(orpc.sessions.submitEnv.mutationOptions());

	const handleSave = async () => {
		const trimmedKey = key.trim().toUpperCase();
		if (!trimmedKey || !value.trim()) return;
		setSaving(true);

		try {
			// Inject into live sandbox
			await submitEnv.mutateAsync({
				sessionId,
				secrets: [{ key: trimmedKey, value, persist: false }],
				envVars: [],
				saveToConfiguration: false,
			});

			// Persist to DB only if the toggle is on
			if (persist) {
				await createSecret.mutateAsync({
					key: trimmedKey,
					value,
					secretType: "secret",
					...(configurationId ? { configurationId: configurationId } : {}),
				});
			}

			setKey("");
			setValue("");
			onSaved();
		} catch {
			// mutation hooks handle errors
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-1.5">
				<Input
					value={key}
					onChange={(e) => setKey(e.target.value.toUpperCase())}
					placeholder="ENV_VAR_NAME"
					className="h-8 text-xs flex-[2]"
					autoComplete="off"
				/>
				<Input
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="Secret value"
					className="h-8 text-xs flex-[3]"
					onKeyDown={(e) => {
						if (e.key === "Enter") handleSave();
					}}
					autoComplete="off"
				/>
				<Button
					size="sm"
					className="h-8 px-3 text-xs shrink-0"
					onClick={handleSave}
					disabled={saving || !key.trim() || !value.trim()}
				>
					{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
				</Button>
			</div>
			<div className="flex items-center gap-2">
				<Switch
					id="persist"
					checked={persist}
					onCheckedChange={setPersist}
					className="h-4 w-7 [&>span]:h-3 [&>span]:w-3"
				/>
				<Label htmlFor="persist" className="text-[11px] text-muted-foreground cursor-pointer">
					{persist ? "Save to vault for future sessions" : "Session only (not saved)"}
				</Label>
			</div>
			<p className="text-[11px] text-muted-foreground">
				Stores a single environment variable. This does not create or update files in the repo.
			</p>
		</div>
	);
}

// ============================================
// Paste .env Form
// ============================================

function PasteEnvForm({
	sessionId,
	configurationId,
	onSaved,
	onClose,
}: {
	sessionId: string;
	configurationId?: string | null;
	onSaved: () => void;
	onClose: () => void;
}) {
	const [text, setText] = useState("");
	const [saving, setSaving] = useState(false);

	const bulkImport = useMutation(orpc.secrets.bulkImport.mutationOptions());
	const submitEnv = useMutation(orpc.sessions.submitEnv.mutationOptions());

	const parsed = useMemo(() => parseEnvText(text), [text]);

	const handleImport = async () => {
		if (parsed.length === 0) return;
		setSaving(true);

		try {
			// Inject all into live sandbox
			await submitEnv.mutateAsync({
				sessionId,
				secrets: parsed.map(({ key, value }) => ({ key, value, persist: false })),
				envVars: [],
				saveToConfiguration: false,
			});

			// Persist to DB
			await bulkImport.mutateAsync({ envText: text });

			setText("");
			onSaved();
			onClose();
		} catch {
			// mutation hooks handle errors
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-2">
			<textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder={"Paste .env file contents\n\nKEY=value\nDATABASE_URL=postgres://..."}
				className="w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-xs resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				autoFocus
			/>
			<div className="flex items-center justify-between">
				<span className="text-[11px] text-muted-foreground">
					{parsed.length > 0
						? `${parsed.length} ${parsed.length === 1 ? "variable" : "variables"} detected`
						: "Paste KEY=value pairs"}
				</span>
				<div className="flex items-center gap-1.5">
					<Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClose}>
						Cancel
					</Button>
					<Button
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={handleImport}
						disabled={saving || parsed.length === 0}
					>
						{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Import"}
					</Button>
				</div>
			</div>
		</div>
	);
}

// ============================================
// Existing secret row
// ============================================

function SecretRow({
	keyName,
	isRequired,
	onDelete,
	isDeleting,
}: {
	keyName: string;
	isRequired: boolean;
	onDelete: () => void;
	isDeleting: boolean;
}) {
	const [showConfirm, setShowConfirm] = useState(false);

	const handleCopyKey = () => {
		navigator.clipboard.writeText(keyName);
		toast.success("Copied to clipboard");
	};

	return (
		<div className="flex items-center border-b border-border/50 hover:bg-muted/50 transition-colors px-4 py-2.5 group">
			{/* Key name */}
			<button
				type="button"
				onClick={handleCopyKey}
				className="font-mono font-medium text-sm truncate text-left min-w-0 flex-1 hover:text-foreground/80"
				title="Click to copy"
			>
				{keyName}
			</button>

			{/* Hidden value indicator */}
			<span className="text-muted-foreground text-sm mx-4 shrink-0">••••••••</span>

			{/* Actions */}
			<div className="flex items-center gap-1 shrink-0">
				{isRequired && <span className="text-[10px] text-muted-foreground mr-1">required</span>}
				{showConfirm ? (
					<div className="flex items-center gap-1">
						<Button
							variant="destructive"
							size="sm"
							className="h-6 px-2 text-[11px]"
							onClick={() => {
								onDelete();
								setShowConfirm(false);
							}}
							disabled={isDeleting}
						>
							{isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-2 text-[11px]"
							onClick={() => setShowConfirm(false)}
						>
							Cancel
						</Button>
					</div>
				) : (
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
						onClick={() => setShowConfirm(true)}
					>
						<Trash2 className="h-3 w-3" />
					</Button>
				)}
			</div>
		</div>
	);
}

// ============================================
// Missing required key row (from env spec)
// ============================================

function MissingKeyRow({
	keyName,
	sessionId,
	configurationId,
	onSaved,
}: {
	keyName: string;
	sessionId: string;
	configurationId?: string | null;
	onSaved: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState("");
	const [saving, setSaving] = useState(false);

	const createSecret = useCreateSecret();
	const submitEnv = useMutation(orpc.sessions.submitEnv.mutationOptions());

	const handleSave = async () => {
		if (!value.trim()) return;
		setSaving(true);

		try {
			await submitEnv.mutateAsync({
				sessionId,
				secrets: [{ key: keyName, value, persist: false }],
				envVars: [],
				saveToConfiguration: false,
			});

			await createSecret.mutateAsync({
				key: keyName,
				value,
				secretType: "secret",
				...(configurationId ? { configurationId: configurationId } : {}),
			});

			setValue("");
			setEditing(false);
			onSaved();
		} catch {
			// mutation hooks handle errors
		} finally {
			setSaving(false);
		}
	};

	if (editing) {
		return (
			<div className="flex items-center gap-1.5 border-b border-border/50 px-4 py-2">
				<span className="font-mono font-medium text-sm shrink-0">{keyName}</span>
				<Input
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="Value"
					className="h-7 text-xs flex-1"
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Enter") handleSave();
						if (e.key === "Escape") {
							setEditing(false);
							setValue("");
						}
					}}
				/>
				<Button
					size="sm"
					className="h-7 px-2 text-xs"
					onClick={handleSave}
					disabled={saving || !value.trim()}
				>
					{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
				</Button>
			</div>
		);
	}

	return (
		<div className="flex items-center border-b border-border/50 hover:bg-muted/50 transition-colors px-4 py-2.5">
			<span className="font-mono font-medium text-sm truncate min-w-0 flex-1">{keyName}</span>
			<span className="text-destructive text-xs mr-3">missing</span>
			<Button
				variant="outline"
				size="sm"
				className="h-6 px-2 text-[11px]"
				onClick={() => setEditing(true)}
			>
				Set
			</Button>
		</div>
	);
}

// ============================================
// Main component
// ============================================

export function EnvironmentPanel({
	sessionId,
	configurationId,
	repoId: _repoId,
	isSetupSession = false,
	workspaceOptions: workspaceOptionsProp,
}: EnvironmentPanelProps) {
	const queryClient = useQueryClient();
	const setMissingEnvKeyCount = usePreviewPanelStore((s) => s.setMissingEnvKeyCount);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [pasteMode, setPasteMode] = useState(false);
	const [filter, setFilter] = useState("");
	const [showLegacyEntry, setShowLegacyEntry] = useState(false);

	// All org secrets
	const { data: secrets, isLoading: secretsLoading } = useSecrets();
	const deleteSecret = useDeleteSecret();

	// Env file spec from configuration
	const { data: envFiles, isLoading: specLoading } = useConfigurationEnvFiles(
		configurationId ?? "",
		!!configurationId,
	);
	const shouldLoadConfiguration =
		!!configurationId && !(workspaceOptionsProp && workspaceOptionsProp.length > 0);
	const { data: configuration } = useConfiguration(configurationId ?? "", shouldLoadConfiguration);

	const configurationWorkspaceOptions = useMemo(() => {
		const repos = configuration?.configurationRepos ?? [];
		if (repos.length === 0) return [];

		const options: Array<{ workspacePath: string; label: string }> = [];
		const seen = new Set<string>();

		for (const repoLink of repos) {
			if (!repoLink.repo || seen.has(repoLink.workspacePath)) continue;
			seen.add(repoLink.workspacePath);

			const repoName = repoLink.repo.githubRepoName.split("/").pop() || repoLink.workspacePath;
			options.push({
				workspacePath: repoLink.workspacePath,
				label:
					repoLink.workspacePath === "."
						? `${repoName} (workspace root)`
						: `${repoName} (${repoLink.workspacePath})`,
			});
		}

		return options;
	}, [configuration]);
	const workspaceOptions =
		workspaceOptionsProp && workspaceOptionsProp.length > 0
			? workspaceOptionsProp
			: configurationWorkspaceOptions;

	// Parse spec keys
	const specKeys = useMemo(() => {
		if (!envFiles || !Array.isArray(envFiles)) return [];
		const keys: Array<{ key: string; required: boolean }> = [];
		for (const file of envFiles as EnvFileSpec[]) {
			for (const k of file.keys) {
				keys.push({ key: k.key, required: k.required !== false });
			}
		}
		return keys;
	}, [envFiles]);

	const specKeyNames = useMemo(() => specKeys.map((k) => k.key), [specKeys]);

	// Check which spec keys are set (configuration-scoped)
	const { data: checkResults, refetch: refetchCheck } = useCheckSecrets(
		specKeyNames,
		undefined,
		configurationId ?? undefined,
		specKeyNames.length > 0,
	);

	const existingSpecKeys = useMemo(() => {
		if (!checkResults) return new Set<string>();
		return new Set(checkResults.filter((r) => r.exists).map((r) => r.key));
	}, [checkResults]);

	// Set of spec key names (for annotating org secrets)
	const specKeySet = useMemo(() => new Set(specKeys.map((k) => k.key)), [specKeys]);

	// Missing required keys from spec
	const missingRequired = useMemo(
		() => specKeys.filter((k) => k.required && !existingSpecKeys.has(k.key)),
		[specKeys, existingSpecKeys],
	);

	const setupRequiredKeys = useMemo(() => specKeys.filter((k) => k.required), [specKeys]);
	const missingCount = isSetupSession ? setupRequiredKeys.length : missingRequired.length;

	useEffect(() => {
		setMissingEnvKeyCount(missingCount);
	}, [missingCount, setMissingEnvKeyCount]);

	useEffect(() => {
		return () => setMissingEnvKeyCount(0);
	}, [setMissingEnvKeyCount]);

	const handleRefresh = () => {
		refetchCheck();
		queryClient.invalidateQueries({ queryKey: orpc.secrets.list.key() });
		queryClient.invalidateQueries({ queryKey: orpc.secrets.check.key() });
	};

	const handleDelete = async (id: string) => {
		setDeletingId(id);
		try {
			await deleteSecret.mutateAsync(id);
			handleRefresh();
		} finally {
			setDeletingId(null);
		}
	};

	const isLoading = secretsLoading || specLoading;

	// Filter secrets and missing keys by search
	const filterLower = filter.toLowerCase();
	const filteredSecrets = useMemo(
		() =>
			filter
				? (secrets ?? []).filter((s) => s.key.toLowerCase().includes(filterLower))
				: (secrets ?? []),
		[secrets, filterLower, filter],
	);
	const filteredMissing = useMemo(
		() =>
			filter
				? missingRequired.filter((k) => k.key.toLowerCase().includes(filterLower))
				: missingRequired,
		[missingRequired, filterLower, filter],
	);

	const totalItems = (secrets?.length ?? 0) + missingRequired.length;
	const showSearch = totalItems >= 6;

	return (
		<PanelShell title="Environment" noPadding>
			<div className="h-full min-h-0 overflow-y-auto">
				{isLoading ? (
					<div className="flex items-center justify-center p-8">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : (
					<div className="p-3 space-y-3">
						{isSetupSession ? (
							<>
								<div className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-2">
									<div className="flex items-start gap-2">
										<FileLock2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
										<div className="space-y-1">
											<p className="text-xs font-medium">Setup secrets are file-based</p>
											<p className="text-[11px] text-muted-foreground leading-relaxed">
												Create a secret file, choose its path in the repo (for example{" "}
												<code>.env.local</code> or <code>apps/api/.env</code>), then paste the file
												contents.
											</p>
										</div>
									</div>
									{configurationId ? (
										<SecretFilesEditor
											configurationId={configurationId}
											sessionId={sessionId}
											initialCreateOpen
											callToActionLabel="Create Secret File"
											workspaceOptions={workspaceOptions}
										/>
									) : (
										<p className="text-[11px] text-muted-foreground">
											Secret files are unavailable because this session is not linked to a
											configuration.
										</p>
									)}
								</div>

								{setupRequiredKeys.length > 0 && (
									<div className="rounded-md border border-border/60 p-2.5">
										<p className="text-xs font-medium">Requested keys to include in your files</p>
										<p className="text-[11px] text-muted-foreground mt-1">
											Add these keys to the secret file(s) above.
										</p>
										<div className="mt-2 flex flex-wrap gap-1.5">
											{setupRequiredKeys.map((k) => (
												<span
													key={k.key}
													className="inline-flex rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-mono"
												>
													{k.key}
												</span>
											))}
										</div>
									</div>
								)}
							</>
						) : (
							<>
								{configurationId ? (
									<>
										<div className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-2">
											<div className="flex items-start gap-2">
												<FileLock2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
												<div className="space-y-1">
													<p className="text-xs font-medium">Preferred: manage secret files</p>
													<p className="text-[11px] text-muted-foreground leading-relaxed">
														Create a secret file, set its path in the repo, and paste contents. This
														matches the Vercel-style env workflow.
													</p>
												</div>
											</div>
											<SecretFilesEditor
												configurationId={configurationId}
												sessionId={sessionId}
												callToActionLabel="Create Secret File"
												workspaceOptions={workspaceOptions}
											/>
										</div>

										<div className="rounded-md border border-border/60 p-2.5">
											<button
												type="button"
												className="w-full inline-flex items-center justify-between text-xs font-medium"
												onClick={() => setShowLegacyEntry((prev) => !prev)}
											>
												<span>Legacy: single env vars</span>
												<ChevronDown
													className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
														showLegacyEntry ? "rotate-180" : ""
													}`}
												/>
											</button>
										</div>

										{showLegacyEntry && (
											<>
												{pasteMode ? (
													<PasteEnvForm
														sessionId={sessionId}
														configurationId={configurationId}
														onSaved={handleRefresh}
														onClose={() => setPasteMode(false)}
													/>
												) : (
													<div className="space-y-1.5">
														<AddVariableForm
															sessionId={sessionId}
															configurationId={configurationId}
															onSaved={handleRefresh}
														/>
														<button
															type="button"
															className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
															onClick={() => setPasteMode(true)}
														>
															<FileUp className="h-3 w-3" />
															Paste .env
														</button>
													</div>
												)}

												{/* Search filter */}
												{showSearch && (
													<div className="relative">
														<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
														<Input
															value={filter}
															onChange={(e) => setFilter(e.target.value)}
															placeholder="Filter variables..."
															className="h-8 text-xs pl-7"
														/>
													</div>
												)}

												{/* Status summary for spec keys */}
												{specKeys.length > 0 && !filter && (
													<p className="text-xs text-muted-foreground">
														{missingCount > 0
															? `${missingCount} required ${missingCount === 1 ? "variable" : "variables"} missing`
															: "All required variables are set"}
													</p>
												)}

												{/* Missing required keys */}
												{filteredMissing.length > 0 && (
													<div>
														<p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider pb-1.5 px-4">
															Required
														</p>
														<div>
															{filteredMissing.map((k) => (
																<MissingKeyRow
																	key={k.key}
																	keyName={k.key}
																	sessionId={sessionId}
																	configurationId={configurationId}
																	onSaved={handleRefresh}
																/>
															))}
														</div>
													</div>
												)}

												{/* All stored variables */}
												{filteredSecrets.length > 0 && (
													<div>
														{(specKeys.length > 0 || missingRequired.length > 0) && !filter && (
															<p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider pb-1.5 px-4">
																Variables
															</p>
														)}
														<div>
															{filteredSecrets.map((secret) => (
																<SecretRow
																	key={secret.id}
																	keyName={secret.key}
																	isRequired={specKeySet.has(secret.key)}
																	onDelete={() => handleDelete(secret.id)}
																	isDeleting={deletingId === secret.id}
																/>
															))}
														</div>
													</div>
												)}

												{/* Empty state */}
												{(!secrets || secrets.length === 0) && specKeys.length === 0 && (
													<p className="text-xs text-muted-foreground py-4 text-center">
														No variables yet. Add one above.
													</p>
												)}
											</>
										)}
									</>
								) : (
									<div className="rounded-md border border-border/70 bg-muted/20 p-3">
										<p className="text-xs font-medium">Secret files unavailable</p>
										<p className="mt-1 text-[11px] text-muted-foreground">
											This session is not attached to a configuration, so file-based secrets cannot
											be saved here.
										</p>
									</div>
								)}
							</>
						)}
					</div>
				)}
			</div>
		</PanelShell>
	);
}
