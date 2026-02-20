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
import { Textarea } from "@/components/ui/textarea";
import { useDeleteSecretFile, useSecretFiles, useUpsertSecretFile } from "@/hooks/use-secret-files";
import { formatDistanceToNow } from "date-fns";
import { FileLock2, Plus, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, type ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";

interface SecretFilesEditorProps {
	configurationId: string;
	initialCreateOpen?: boolean;
	callToActionLabel?: string;
	workspaceOptions?: WorkspaceOption[];
}

interface WorkspaceOption {
	workspacePath: string;
	label: string;
}

interface EnvRow {
	id: string;
	key: string;
	value: string;
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function createRow(key = "", value = ""): EnvRow {
	return {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
		key,
		value,
	};
}

function parseEnvRows(content: string): EnvRow[] {
	const rows: EnvRow[] = [];

	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
		const separator = normalized.indexOf("=");
		if (separator <= 0) continue;

		const key = normalized.slice(0, separator).trim();
		let value = normalized.slice(separator + 1).trim();
		if (!ENV_KEY_PATTERN.test(key)) continue;

		// Preserve plain values but unwrap simple quoted values for editing UX.
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		if (key) {
			rows.push(createRow(key, value));
		}
	}

	return rows;
}

function serializeEnvRows(rows: EnvRow[]): string {
	return rows
		.map((row) => ({
			key: row.key.trim(),
			value: row.value,
		}))
		.filter((row) => row.key.length > 0)
		.map((row) => `${row.key}=${row.value}`)
		.join("\n");
}

function normalizeRelativePath(path: string): string {
	return path
		.trim()
		.replace(/^\.\/+/, "")
		.replace(/^\/+/, "");
}

function joinWorkspaceAndPath(workspacePath: string, path: string): string {
	const normalizedPath = normalizeRelativePath(path);
	if (!normalizedPath) return "";

	if (!workspacePath || workspacePath === ".") {
		return normalizedPath;
	}

	return normalizedPath.startsWith(`${workspacePath}/`)
		? normalizedPath
		: `${workspacePath}/${normalizedPath}`;
}

function splitStoredPath(
	storedPath: string,
	workspacePaths: string[],
): { workspacePath: string; relativePath: string } {
	const nonRootWorkspaces = workspacePaths
		.filter((workspacePath) => workspacePath !== ".")
		.sort((a, b) => b.length - a.length);

	for (const workspacePath of nonRootWorkspaces) {
		if (storedPath === workspacePath) {
			return { workspacePath, relativePath: "" };
		}
		if (storedPath.startsWith(`${workspacePath}/`)) {
			return {
				workspacePath,
				relativePath: storedPath.slice(workspacePath.length + 1),
			};
		}
	}

	return { workspacePath: ".", relativePath: storedPath };
}

function buildDestinationTree(workspacePath: string, relativePath: string): string {
	const normalizedPath = normalizeRelativePath(relativePath);
	if (!normalizedPath) return "";

	const pathSegments = normalizedPath.split("/").filter(Boolean);
	const nodes =
		workspacePath && workspacePath !== "." ? [workspacePath, ...pathSegments] : pathSegments;
	const lines = ["workspace/"];

	for (const [index, node] of nodes.entries()) {
		const isLast = index === nodes.length - 1;
		lines.push(`${"  ".repeat(index + 1)}${node}${isLast ? "" : "/"}`);
	}

	return lines.join("\n");
}

export function SecretFilesEditor({
	configurationId,
	initialCreateOpen = false,
	callToActionLabel = "Add File",
	workspaceOptions,
}: SecretFilesEditorProps) {
	const { data: filesData, isLoading } = useSecretFiles(configurationId);
	const files = filesData?.files ?? [];
	const upsertFile = useUpsertSecretFile(configurationId);
	const deleteFile = useDeleteSecretFile(configurationId);

	const resolvedWorkspaces = useMemo(() => {
		if (workspaceOptions && workspaceOptions.length > 0) {
			return workspaceOptions;
		}
		return [{ workspacePath: ".", label: "Workspace root" }];
	}, [workspaceOptions]);
	const workspacePaths = useMemo(
		() => resolvedWorkspaces.map((workspace) => workspace.workspacePath),
		[resolvedWorkspaces],
	);
	const workspaceLabelByPath = useMemo(
		() =>
			new Map(
				resolvedWorkspaces.map((workspace) => [workspace.workspacePath, workspace.label] as const),
			),
		[resolvedWorkspaces],
	);
	const showWorkspaceSelector = resolvedWorkspaces.length > 1;

	const [adding, setAdding] = useState(initialCreateOpen);
	const [newWorkspacePath, setNewWorkspacePath] = useState(
		resolvedWorkspaces[0]?.workspacePath ?? ".",
	);
	const [newPath, setNewPath] = useState("");
	const [rows, setRows] = useState<EnvRow[]>([createRow()]);
	const [showPasteImport, setShowPasteImport] = useState(false);
	const [pasteDraft, setPasteDraft] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editContent, setEditContent] = useState("");
	const fileInputRef = useRef<HTMLInputElement>(null);

	const activeRows = useMemo(() => rows.filter((row) => row.key.trim().length > 0), [rows]);
	const serializedContent = useMemo(() => serializeEnvRows(rows), [rows]);
	const resolvedPathPreview = useMemo(
		() => joinWorkspaceAndPath(newWorkspacePath, newPath),
		[newWorkspacePath, newPath],
	);
	const destinationTreePreview = useMemo(
		() => buildDestinationTree(newWorkspacePath, newPath),
		[newWorkspacePath, newPath],
	);
	const canSave = resolvedPathPreview.length > 0 && activeRows.length > 0;

	useEffect(() => {
		if (resolvedWorkspaces.some((workspace) => workspace.workspacePath === newWorkspacePath)) {
			return;
		}
		setNewWorkspacePath(resolvedWorkspaces[0]?.workspacePath ?? ".");
	}, [resolvedWorkspaces, newWorkspacePath]);

	const clearComposer = () => {
		setNewPath("");
		setRows([createRow()]);
		setShowPasteImport(false);
		setPasteDraft("");

		if (!initialCreateOpen) {
			setAdding(false);
		}
	};

	const openComposer = () => {
		setAdding(true);
		setShowPasteImport(false);
		setPasteDraft("");
		setRows((prev) => (prev.length > 0 ? prev : [createRow()]));
	};

	const handleAdd = async () => {
		if (!canSave) return;
		const resolvedFilePath = joinWorkspaceAndPath(newWorkspacePath, newPath);
		if (!resolvedFilePath) return;

		await upsertFile.mutateAsync({
			configurationId,
			filePath: resolvedFilePath,
			content: serializedContent,
		});

		clearComposer();
	};

	const handleUpdate = async (filePath: string) => {
		if (!editContent.trim()) return;

		await upsertFile.mutateAsync({
			configurationId,
			filePath,
			content: editContent,
		});

		setEditingId(null);
		setEditContent("");
	};

	const handleDelete = async (id: string) => {
		await deleteFile.mutateAsync({ id });
	};

	const handleUploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;

		const content = await file.text();
		const parsedRows = parseEnvRows(content);

		setAdding(true);
		setNewPath((prev) => prev || file.name);
		setRows(parsedRows.length > 0 ? parsedRows : [createRow()]);
		setShowPasteImport(false);
		setPasteDraft("");
		event.target.value = "";
	};

	const handleImportPaste = () => {
		const imported = parseEnvRows(pasteDraft);
		if (imported.length === 0) return;

		setRows(imported);
		setShowPasteImport(false);
		setPasteDraft("");
	};

	const handleRowPaste = (event: ClipboardEvent<HTMLInputElement>) => {
		const pastedText = event.clipboardData.getData("text");
		if (!pastedText) return;

		const imported = parseEnvRows(pastedText);
		if (imported.length === 0) return;

		event.preventDefault();
		setRows(imported);
		setShowPasteImport(false);
		setPasteDraft("");
	};

	const updateRow = (id: string, field: "key" | "value", value: string) => {
		setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
	};

	const removeRow = (id: string) => {
		setRows((prev) => {
			const next = prev.filter((row) => row.id !== id);
			return next.length > 0 ? next : [createRow()];
		});
	};

	const addRow = () => {
		setRows((prev) => [...prev, createRow()]);
	};

	const formatRelativeTime = (updatedAt: string | null, createdAt: string | null): string => {
		const value = updatedAt ?? createdAt;
		if (!value) return "Unknown";
		return formatDistanceToNow(new Date(value), { addSuffix: true });
	};

	if (isLoading) {
		return <p className="text-xs text-muted-foreground">Loading secret files...</p>;
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<FileLock2 className="h-3.5 w-3.5 text-muted-foreground" />
					<p className="text-xs font-medium">Secret Files</p>
				</div>
				<div className="flex items-center gap-1.5">
					<input
						ref={fileInputRef}
						type="file"
						accept=".env,.txt"
						className="hidden"
						onChange={handleUploadFile}
					/>
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-xs gap-1.5"
						onClick={() => fileInputRef.current?.click()}
					>
						<Upload className="h-3 w-3" />
						Upload file
					</Button>
					{!adding && (
						<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={openComposer}>
							<Plus className="h-3 w-3 mr-1" />
							{callToActionLabel}
						</Button>
					)}
				</div>
			</div>

			<p className="text-[11px] text-muted-foreground">
				Use the row editor below to build env files. Paste or upload to auto-fill rows, then save
				the file path.
			</p>
			<p className="text-[11px] text-muted-foreground">
				Secret file values are encrypted at rest and never shown again after save.
			</p>

			{adding && (
				<div className="rounded-md border border-border/70 overflow-hidden">
					<div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
						<p className="text-xs font-medium">New Secret File</p>
						<p className="text-[11px] text-muted-foreground">
							{activeRows.length} {activeRows.length === 1 ? "variable" : "variables"} ready
						</p>
					</div>
					<div className="p-3 space-y-2">
						{showWorkspaceSelector && (
							<div className="space-y-1">
								<Label className="text-[11px] text-muted-foreground">Repository / workspace</Label>
								<Select value={newWorkspacePath} onValueChange={setNewWorkspacePath}>
									<SelectTrigger className="h-8 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{resolvedWorkspaces.map((workspace) => (
											<SelectItem
												key={workspace.workspacePath}
												value={workspace.workspacePath}
												className="text-xs"
											>
												{workspace.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						<div className="space-y-1">
							<Label className="text-[11px] text-muted-foreground">File path in project</Label>
							<Input
								value={newPath}
								onChange={(e) => setNewPath(e.target.value)}
								placeholder="Path in selected workspace (e.g. .env.local, apps/api/.env)"
								className="h-8 text-xs font-mono"
							/>
							{resolvedPathPreview && (
								<div className="space-y-1 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
									<p className="text-[11px] text-muted-foreground">
										Saves to <code>{resolvedPathPreview}</code>
									</p>
									{destinationTreePreview && (
										<>
											<p className="text-[11px] text-muted-foreground">Destination preview</p>
											<pre className="text-[11px] font-mono leading-5 text-foreground/90 whitespace-pre-wrap">
												{destinationTreePreview}
											</pre>
										</>
									)}
								</div>
							)}
						</div>

						<div className="rounded-md border border-border/60 overflow-hidden">
							<div className="flex items-center gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
								<span className="min-w-0 flex-1">Key</span>
								<span className="min-w-0 flex-1">Value</span>
								<span className="w-16 text-right">Actions</span>
							</div>
							{rows.map((row) => (
								<div
									key={row.id}
									className="flex items-center gap-3 border-b border-border/50 px-3 py-1.5 last:border-b-0"
								>
									<Input
										value={row.key}
										onChange={(e) => updateRow(row.id, "key", e.target.value.toUpperCase())}
										onPaste={handleRowPaste}
										placeholder="ENV_VAR_NAME"
										className="h-7 text-xs font-mono min-w-0 flex-1"
										autoComplete="off"
									/>
									<Input
										type="password"
										value={row.value}
										onChange={(e) => updateRow(row.id, "value", e.target.value)}
										onPaste={handleRowPaste}
										placeholder="Secret value"
										className="h-7 text-xs font-mono min-w-0 flex-1"
										autoComplete="off"
									/>
									<div className="w-16 flex justify-end">
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
											onClick={() => removeRow(row.id)}
										>
											<Trash2 className="h-3 w-3" />
										</Button>
									</div>
								</div>
							))}
						</div>

						<div className="flex items-center justify-between">
							<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={addRow}>
								<Plus className="h-3 w-3 mr-1" />
								Add Row
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs"
								onClick={() => setShowPasteImport((prev) => !prev)}
							>
								Paste .env
							</Button>
						</div>

						{showPasteImport && (
							<div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
								<Label className="text-[11px] text-muted-foreground">Paste .env content</Label>
								<Textarea
									value={pasteDraft}
									onChange={(e) => setPasteDraft(e.target.value)}
									placeholder={"KEY=value\nDATABASE_URL=postgres://..."}
									className="text-xs font-mono min-h-[100px]"
								/>
								<div className="flex justify-end">
									<Button
										size="sm"
										className="h-7 text-xs"
										onClick={handleImportPaste}
										disabled={parseEnvRows(pasteDraft).length === 0}
									>
										Fill Rows from Paste
									</Button>
								</div>
							</div>
						)}

						<div className="flex justify-end gap-2">
							{!initialCreateOpen && (
								<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearComposer}>
									Cancel
								</Button>
							)}
							<Button
								size="sm"
								className="h-7 text-xs"
								onClick={handleAdd}
								disabled={upsertFile.isPending || !canSave}
							>
								{upsertFile.isPending ? "Saving..." : "Save Secret File"}
							</Button>
						</div>
					</div>
				</div>
			)}

			{files.length > 0 ? (
				<div className="rounded-md border border-border/70 overflow-hidden">
					<div className="flex items-center gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
						{showWorkspaceSelector ? (
							<>
								<span className="w-40 shrink-0">Workspace</span>
								<span className="min-w-0 flex-1">Path</span>
							</>
						) : (
							<span className="min-w-0 flex-1">File path</span>
						)}
						<span className="w-24 text-right">Value</span>
						<span className="w-28 text-right">Updated</span>
						<span className="w-28 text-right">Actions</span>
					</div>
					{files.map((file) => {
						const splitPath = splitStoredPath(file.filePath, workspacePaths);
						const workspaceLabel =
							workspaceLabelByPath.get(splitPath.workspacePath) ??
							(splitPath.workspacePath === "."
								? "Workspace root"
								: `${splitPath.workspacePath} (legacy)`);

						return (
							<div key={file.id} className="border-b border-border/60 last:border-b-0">
								<div className="flex items-center gap-3 px-3 py-2.5">
									{showWorkspaceSelector ? (
										<>
											<div className="w-40 shrink-0">
												<span className="text-xs text-muted-foreground">{workspaceLabel}</span>
											</div>
											<div className="min-w-0 flex-1">
												<code className="text-xs font-mono">
													{splitPath.relativePath || file.filePath}
												</code>
											</div>
										</>
									) : (
										<div className="min-w-0 flex-1">
											<code className="text-xs font-mono">{file.filePath}</code>
										</div>
									)}
									<span className="w-24 text-right text-xs text-muted-foreground">
										••••••••••••
									</span>
									<span className="w-28 text-right text-[11px] text-muted-foreground">
										{formatRelativeTime(file.updatedAt, file.createdAt)}
									</span>
									<div className="w-28 flex justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											className="h-6 text-[11px]"
											onClick={() => {
												if (editingId === file.id) {
													setEditingId(null);
													setEditContent("");
													return;
												}
												setEditingId(file.id);
												setEditContent("");
											}}
										>
											{editingId === file.id ? "Close" : "Replace"}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
											onClick={() => handleDelete(file.id)}
											disabled={deleteFile.isPending}
										>
											<Trash2 className="h-3 w-3" />
										</Button>
									</div>
								</div>
								{editingId === file.id && (
									<div className="border-t border-border/60 bg-muted/20 p-3 space-y-2">
										<Label className="text-[11px] text-muted-foreground">
											Replace file contents
										</Label>
										<Textarea
											value={editContent}
											onChange={(e) => setEditContent(e.target.value)}
											placeholder="Paste new file contents"
											className="text-xs font-mono min-h-[100px]"
										/>
										<div className="flex justify-end gap-2">
											<Button
												variant="ghost"
												size="sm"
												className="h-7 text-xs"
												onClick={() => {
													setEditingId(null);
													setEditContent("");
												}}
											>
												Cancel
											</Button>
											<Button
												size="sm"
												className="h-7 text-xs"
												onClick={() => handleUpdate(file.filePath)}
												disabled={upsertFile.isPending || !editContent.trim()}
											>
												{upsertFile.isPending ? "Saving..." : "Save Replacement"}
											</Button>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			) : (
				<p className="text-xs text-muted-foreground">No secret files yet. Create one above.</p>
			)}
		</div>
	);
}
