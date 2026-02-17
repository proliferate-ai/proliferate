"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCheckSecrets, useCreateSecret, usePrebuildEnvFiles } from "@/hooks/use-repos";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, FileText, Loader2, Plus, X } from "lucide-react";
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
// Per-key row component
// ============================================

function SecretKeyRow({
	keyName,
	required,
	exists,
	sessionId,
	prebuildId,
	onSaved,
}: {
	keyName: string;
	required: boolean;
	exists: boolean;
	sessionId: string;
	prebuildId?: string | null;
	onSaved: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState("");
	const [persist, setPersist] = useState(true);
	const [sessionOnly, setSessionOnly] = useState(false);
	const [saving, setSaving] = useState(false);

	const createSecret = useCreateSecret();
	const submitEnv = useMutation(orpc.sessions.submitEnv.mutationOptions());

	const handleSave = async () => {
		if (!value.trim()) return;
		setSaving(true);

		try {
			// Always inject into the live sandbox
			await submitEnv.mutateAsync({
				sessionId,
				secrets: [{ key: keyName, value, persist: false }],
				envVars: [],
				saveToPrebuild: false,
			});

			if (persist && prebuildId) {
				// Persist to DB with configuration linking
				await createSecret.mutateAsync({
					key: keyName,
					value,
					configurationId: prebuildId,
					secretType: "secret",
				});
			} else {
				setSessionOnly(true);
			}

			setValue("");
			setEditing(false);
			onSaved();
		} catch {
			// Error handling — the mutation hooks handle toast/logging
		} finally {
			setSaving(false);
		}
	};

	// Key exists and not editing — show set badge
	if (exists && !editing) {
		return (
			<div className="flex items-center justify-between py-1.5">
				<div className="flex items-center gap-2 min-w-0">
					<span className="text-xs font-medium truncate">{keyName}</span>
					{required && <span className="text-destructive text-[10px]">*</span>}
				</div>
				<div className="flex items-center gap-1.5 shrink-0">
					<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
						<CheckCircle className="h-3 w-3" />
						Set
					</span>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-1.5 text-[11px] text-muted-foreground"
						onClick={() => setEditing(true)}
					>
						Edit
					</Button>
				</div>
			</div>
		);
	}

	// Session-only indicator (saved without persistence)
	if (sessionOnly && !editing) {
		return (
			<div className="flex items-center justify-between py-1.5">
				<div className="flex items-center gap-2 min-w-0">
					<span className="text-xs font-medium truncate">{keyName}</span>
					{required && <span className="text-destructive text-[10px]">*</span>}
				</div>
				<div className="flex items-center gap-1.5 shrink-0">
					<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
						<CheckCircle className="h-3 w-3" />
						Session Only
					</span>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-1.5 text-[11px] text-muted-foreground"
						onClick={() => {
							setEditing(true);
							setSessionOnly(false);
						}}
					>
						Edit
					</Button>
				</div>
			</div>
		);
	}

	// Missing or editing — show input
	return (
		<div className="space-y-1.5 py-1.5">
			<div className="flex items-center gap-2">
				<span className="text-xs font-medium">{keyName}</span>
				{required && <span className="text-destructive text-[10px]">*</span>}
			</div>
			<div className="flex items-center gap-1.5">
				<Input
					type="password"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={`Enter ${keyName}`}
					className="h-7 text-xs flex-1"
					onKeyDown={(e) => {
						if (e.key === "Enter") handleSave();
					}}
				/>
				<Button
					size="sm"
					className="h-7 px-2.5 text-xs"
					onClick={handleSave}
					disabled={saving || !value.trim()}
				>
					{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
				</Button>
			</div>
			<div className="flex items-center gap-2">
				<Checkbox
					id={`persist-${keyName}`}
					checked={persist}
					onCheckedChange={(checked) => setPersist(checked === true)}
					className="h-3.5 w-3.5"
				/>
				<label
					htmlFor={`persist-${keyName}`}
					className="text-[11px] text-muted-foreground cursor-pointer"
				>
					Save securely
				</label>
			</div>
		</div>
	);
}

// ============================================
// Add secret form (for manual entry)
// ============================================

function AddSecretForm({
	sessionId,
	prebuildId,
	onSaved,
}: {
	sessionId: string;
	prebuildId?: string | null;
	onSaved: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
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
			await submitEnv.mutateAsync({
				sessionId,
				secrets: [{ key: trimmedKey, value, persist: false }],
				envVars: [],
				saveToPrebuild: false,
			});

			if (persist && prebuildId) {
				await createSecret.mutateAsync({
					key: trimmedKey,
					value,
					configurationId: prebuildId,
					secretType: "secret",
				});
			}

			setKey("");
			setValue("");
			setExpanded(false);
			onSaved();
		} catch {
			// Error handling — mutation hooks handle toast/logging
		} finally {
			setSaving(false);
		}
	};

	if (!expanded) {
		return (
			<Button
				variant="outline"
				size="sm"
				className="w-full justify-start gap-2 text-xs text-muted-foreground"
				onClick={() => setExpanded(true)}
			>
				<Plus className="h-3.5 w-3.5" />
				Add Secret
			</Button>
		);
	}

	return (
		<div className="space-y-2 rounded-md border border-border p-2.5">
			<Input
				type="text"
				value={key}
				onChange={(e) => setKey(e.target.value.toUpperCase())}
				placeholder="KEY_NAME"
				className="h-7 text-xs font-mono"
				autoFocus
			/>
			<Input
				type="password"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="Value"
				className="h-7 text-xs"
				onKeyDown={(e) => {
					if (e.key === "Enter") handleSave();
				}}
			/>
			<div className="flex items-center gap-2">
				<Checkbox
					id="persist-new"
					checked={persist}
					onCheckedChange={(checked) => setPersist(checked === true)}
					className="h-3.5 w-3.5"
				/>
				<label htmlFor="persist-new" className="text-[11px] text-muted-foreground cursor-pointer">
					Save securely
				</label>
			</div>
			<div className="flex items-center gap-1.5">
				<Button
					size="sm"
					className="h-7 px-2.5 text-xs flex-1"
					onClick={handleSave}
					disabled={saving || !key.trim() || !value.trim()}
				>
					{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2.5 text-xs"
					onClick={() => {
						setExpanded(false);
						setKey("");
						setValue("");
					}}
				>
					Cancel
				</Button>
			</div>
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

	// Fetch env file spec from the configuration
	const { data: envFiles, isLoading: specLoading } = usePrebuildEnvFiles(
		prebuildId ?? "",
		!!prebuildId,
	);

	// Parse the spec into typed array
	const parsedFiles = useMemo<EnvFileSpec[]>(() => {
		if (!envFiles || !Array.isArray(envFiles)) return [];
		return envFiles as EnvFileSpec[];
	}, [envFiles]);

	// Extract all keys from all files
	const allKeys = useMemo(() => {
		const keys: string[] = [];
		for (const file of parsedFiles) {
			for (const k of file.keys) {
				keys.push(k.key);
			}
		}
		return keys;
	}, [parsedFiles]);

	// Check which keys are set (configuration-scoped)
	const {
		data: checkResults,
		isLoading: checkLoading,
		refetch: refetchCheck,
	} = useCheckSecrets(allKeys, undefined, prebuildId ?? undefined, allKeys.length > 0);

	// Build a set of existing keys
	const existingKeySet = useMemo(() => {
		if (!checkResults) return new Set<string>();
		return new Set(checkResults.filter((r) => r.exists).map((r) => r.key));
	}, [checkResults]);

	// Count missing required keys and update store
	const missingCount = useMemo(() => {
		let count = 0;
		for (const file of parsedFiles) {
			for (const k of file.keys) {
				if (k.required !== false && !existingKeySet.has(k.key)) {
					count++;
				}
			}
		}
		return count;
	}, [parsedFiles, existingKeySet]);

	useEffect(() => {
		setMissingEnvKeyCount(missingCount);
	}, [missingCount, setMissingEnvKeyCount]);

	// Reset count on unmount
	useEffect(() => {
		return () => setMissingEnvKeyCount(0);
	}, [setMissingEnvKeyCount]);

	const handleSecretSaved = () => {
		refetchCheck();
		queryClient.invalidateQueries({ queryKey: orpc.secrets.check.key() });
	};

	const isLoading = specLoading || checkLoading;

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
					{isLoading && prebuildId ? (
						<div className="flex items-center justify-center p-8">
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						</div>
					) : (
						<div className="p-3 space-y-4">
							{parsedFiles.length === 0 ? (
								<p className="text-xs text-muted-foreground">
									{!prebuildId
										? "No configuration detected yet. You can add secrets manually below."
										: "No environment files configured for this snapshot."}
								</p>
							) : (
								<>
									<p className="text-xs text-muted-foreground">
										{missingCount > 0
											? `${missingCount} required ${missingCount === 1 ? "variable" : "variables"} missing.`
											: "All required variables are set."}
									</p>

									{parsedFiles.map((file) => {
										const filePath =
											file.workspacePath && file.workspacePath !== "."
												? `${file.workspacePath}/${file.path}`
												: file.path;

										return (
											<div key={filePath}>
												{/* File header */}
												<div className="flex items-center gap-1.5 pb-1.5 mb-1.5 border-b border-border/50">
													<FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
													<span className="text-xs font-medium text-muted-foreground">
														{filePath}
													</span>
													<span className="text-[10px] text-muted-foreground">
														({file.keys.filter((k) => existingKeySet.has(k.key)).length}/
														{file.keys.length})
													</span>
												</div>

												{/* Keys */}
												<div className="space-y-0.5">
													{file.keys.map((k) => (
														<SecretKeyRow
															key={k.key}
															keyName={k.key}
															required={k.required !== false}
															exists={existingKeySet.has(k.key)}
															sessionId={sessionId}
															prebuildId={prebuildId}
															onSaved={handleSecretSaved}
														/>
													))}
												</div>
											</div>
										);
									})}
								</>
							)}

							<AddSecretForm
								sessionId={sessionId}
								prebuildId={prebuildId}
								onSaved={handleSecretSaved}
							/>
						</div>
					)}
				</div>
			</div>
		</TooltipProvider>
	);
}
