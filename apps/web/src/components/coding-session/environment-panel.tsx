"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCheckSecrets, usePrebuildEnvFiles } from "@/hooks/use-repos";
import { useCreateSecret, useDeleteSecret, useSecrets } from "@/hooks/use-secrets";
import { orpc } from "@/lib/orpc";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
	prebuildId?: string | null;
	repoId?: string | null;
	onClose: () => void;
}

// ============================================
// Add Variable Form (always visible)
// ============================================

function AddVariableForm({
	sessionId,
	prebuildId,
	onSaved,
}: {
	sessionId: string;
	prebuildId?: string | null;
	onSaved: () => void;
}) {
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");
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
				saveToPrebuild: false,
			});

			// Persist to DB (with configuration linking if available)
			await createSecret.mutateAsync({
				key: trimmedKey,
				value,
				secretType: "secret",
				...(prebuildId ? { configurationId: prebuildId } : {}),
			});

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
		<div className="flex items-center gap-1.5">
			<Input
				value={key}
				onChange={(e) => setKey(e.target.value.toUpperCase())}
				placeholder="KEY"
				className="h-8 text-xs flex-[2]"
				autoComplete="off"
			/>
			<Input
				type="password"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="Value"
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
	return (
		<div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-muted/50 transition-colors group">
			<div className="flex items-center gap-2 min-w-0">
				<span className="text-xs font-medium truncate">{keyName}</span>
				{isRequired && <span className="text-[10px] text-muted-foreground">required</span>}
			</div>
			<div className="flex items-center gap-2 shrink-0">
				<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
					<Lock className="h-3 w-3" />
					Encrypted
				</span>
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
					onClick={onDelete}
					disabled={isDeleting}
				>
					{isDeleting ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<Trash2 className="h-3 w-3" />
					)}
				</Button>
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
	prebuildId,
	onSaved,
}: {
	keyName: string;
	sessionId: string;
	prebuildId?: string | null;
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
				saveToPrebuild: false,
			});

			await createSecret.mutateAsync({
				key: keyName,
				value,
				secretType: "secret",
				...(prebuildId ? { configurationId: prebuildId } : {}),
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
			<div className="flex items-center gap-1.5 px-2 py-1.5">
				<span className="text-xs font-medium shrink-0">{keyName}</span>
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
		<div className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-muted/50 transition-colors">
			<div className="flex items-center gap-2 min-w-0">
				<span className="text-xs font-medium truncate">{keyName}</span>
				<span className="text-[10px] text-destructive">missing</span>
			</div>
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
	prebuildId,
	repoId,
	onClose,
}: EnvironmentPanelProps) {
	const queryClient = useQueryClient();
	const setMissingEnvKeyCount = usePreviewPanelStore((s) => s.setMissingEnvKeyCount);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	// All org secrets
	const { data: secrets, isLoading: secretsLoading } = useSecrets();
	const deleteSecret = useDeleteSecret();

	// Env file spec from configuration
	const { data: envFiles, isLoading: specLoading } = usePrebuildEnvFiles(
		prebuildId ?? "",
		!!prebuildId,
	);

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
	const {
		data: checkResults,
		isLoading: checkLoading,
		refetch: refetchCheck,
	} = useCheckSecrets(specKeyNames, undefined, prebuildId ?? undefined, specKeyNames.length > 0);

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

	const missingCount = missingRequired.length;

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

	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex flex-col h-full">
				{/* Header */}
				<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
					<span className="text-sm font-medium">Environment</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
								<X className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Close panel</TooltipContent>
					</Tooltip>
				</div>

				{/* Content */}
				<div className="flex-1 min-h-0 overflow-y-auto">
					{isLoading ? (
						<div className="flex items-center justify-center p-8">
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						</div>
					) : (
						<div className="p-3 space-y-3">
							{/* Always-visible add form */}
							<AddVariableForm
								sessionId={sessionId}
								prebuildId={prebuildId}
								onSaved={handleRefresh}
							/>

							{/* Status summary for spec keys */}
							{specKeys.length > 0 && (
								<p className="text-xs text-muted-foreground">
									{missingCount > 0
										? `${missingCount} required ${missingCount === 1 ? "variable" : "variables"} missing`
										: "All required variables are set"}
								</p>
							)}

							{/* Missing required keys */}
							{missingRequired.length > 0 && (
								<div>
									<p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider pb-1.5">
										Required
									</p>
									<div className="space-y-0.5">
										{missingRequired.map((k) => (
											<MissingKeyRow
												key={k.key}
												keyName={k.key}
												sessionId={sessionId}
												prebuildId={prebuildId}
												onSaved={handleRefresh}
											/>
										))}
									</div>
								</div>
							)}

							{/* All stored variables */}
							{secrets && secrets.length > 0 && (
								<div>
									{(specKeys.length > 0 || missingRequired.length > 0) && (
										<p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider pb-1.5">
											Variables
										</p>
									)}
									<div className="space-y-0.5">
										{secrets.map((secret) => (
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
						</div>
					)}
				</div>
			</div>
		</TooltipProvider>
	);
}
