"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDeleteSecretFile, useSecretFiles, useUpsertSecretFile } from "@/hooks/use-secret-files";
import { formatDistanceToNow } from "date-fns";
import { FileLock2, Plus, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, useMemo, useRef, useState } from "react";

interface SecretFilesEditorProps {
	configurationId: string;
	initialCreateOpen?: boolean;
	callToActionLabel?: string;
}

function parseEnvKeys(content: string): string[] {
	const keys: string[] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const separator = trimmed.indexOf("=");
		if (separator <= 0) continue;
		const key = trimmed.slice(0, separator).trim();
		if (key) keys.push(key);
	}
	return keys;
}

export function SecretFilesEditor({
	configurationId,
	initialCreateOpen = false,
	callToActionLabel = "Add File",
}: SecretFilesEditorProps) {
	const { data: filesData, isLoading } = useSecretFiles(configurationId);
	const files = filesData?.files ?? [];
	const upsertFile = useUpsertSecretFile(configurationId);
	const deleteFile = useDeleteSecretFile(configurationId);

	const [adding, setAdding] = useState(initialCreateOpen);
	const [newPath, setNewPath] = useState("");
	const [newContent, setNewContent] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editContent, setEditContent] = useState("");
	const fileInputRef = useRef<HTMLInputElement>(null);

	const clearComposer = () => {
		setNewPath("");
		setNewContent("");
		if (!initialCreateOpen) {
			setAdding(false);
		}
	};

	const handleAdd = async () => {
		if (!newPath.trim() || !newContent.trim()) return;
		await upsertFile.mutateAsync({
			configurationId,
			filePath: newPath.trim(),
			content: newContent,
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
		setAdding(true);
		setNewPath((prev) => prev || file.name);
		setNewContent(content);
		event.target.value = "";
	};

	const formatRelativeTime = (updatedAt: string | null, createdAt: string | null): string => {
		const value = updatedAt ?? createdAt;
		if (!value) return "Unknown";
		return formatDistanceToNow(new Date(value), { addSuffix: true });
	};

	const parsedKeys = useMemo(() => parseEnvKeys(newContent), [newContent]);
	const parsedKeyRows = useMemo(() => {
		const counts = new Map<string, number>();
		return parsedKeys.map((key) => {
			const next = (counts.get(key) ?? 0) + 1;
			counts.set(key, next);
			return {
				id: `${key}-${next}`,
				key,
			};
		});
	}, [parsedKeys]);

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
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-xs"
							onClick={() => setAdding(true)}
						>
							<Plus className="h-3 w-3 mr-1" />
							{callToActionLabel}
						</Button>
					)}
				</div>
			</div>

			<p className="text-[11px] text-muted-foreground">
				Create or upload a file, choose its path in the repo, and save. Proliferate writes this file
				for setup and future boots.
			</p>
			<p className="text-[11px] text-muted-foreground">
				Secret file values are encrypted at rest and never shown again after save.
			</p>

			{adding && (
				<div className="rounded-md border border-border/70 overflow-hidden">
					<div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
						<p className="text-xs font-medium">New Secret File</p>
						<p className="text-[11px] text-muted-foreground">Paste or upload, then save</p>
					</div>
					<div className="p-3 space-y-2">
						<div className="space-y-1">
							<Label className="text-[11px] text-muted-foreground">File path in project</Label>
							<Input
								value={newPath}
								onChange={(e) => setNewPath(e.target.value)}
								placeholder="Path in repo (e.g. .env.local, apps/api/.env)"
								className="h-8 text-xs font-mono"
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-[11px] text-muted-foreground">File contents</Label>
							<Textarea
								value={newContent}
								onChange={(e) => setNewContent(e.target.value)}
								placeholder="Paste file contents"
								className="text-xs font-mono min-h-[120px]"
							/>
						</div>
						{parsedKeys.length > 0 && (
							<div className="rounded-md border border-border/60 overflow-hidden">
								<div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
									<p className="text-[11px] font-medium">Detected rows from paste</p>
									<p className="text-[11px] text-muted-foreground">{parsedKeys.length} variables</p>
								</div>
								<div className="max-h-40 overflow-y-auto">
									{parsedKeyRows.slice(0, 30).map((row) => (
										<div
											key={row.id}
											className="flex items-center gap-3 border-b border-border/50 px-3 py-1.5 last:border-b-0"
										>
											<span className="min-w-0 flex-1 truncate text-xs font-mono">{row.key}</span>
											<span className="text-[11px] text-muted-foreground">••••••••••••</span>
										</div>
									))}
								</div>
								{parsedKeys.length > 30 && (
									<div className="border-t border-border bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
										+{parsedKeys.length - 30} more rows
									</div>
								)}
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
								disabled={upsertFile.isPending || !newPath.trim() || !newContent.trim()}
							>
								{upsertFile.isPending ? "Saving..." : "Save Secret File"}
							</Button>
						</div>
					</div>
				</div>
			)}

			{/* Existing files */}
			{files.length > 0 ? (
				<div className="rounded-md border border-border/70 overflow-hidden">
					<div className="flex items-center gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
						<span className="min-w-0 flex-1">File path</span>
						<span className="w-24 text-right">Value</span>
						<span className="w-28 text-right">Updated</span>
						<span className="w-28 text-right">Actions</span>
					</div>
					{files.map((file) => (
						<div key={file.id} className="border-b border-border/60 last:border-b-0">
							<div className="flex items-center gap-3 px-3 py-2.5">
								<div className="min-w-0 flex-1">
									<code className="text-xs font-mono">{file.filePath}</code>
								</div>
								<span className="w-24 text-right text-xs text-muted-foreground">••••••••••••</span>
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
									<Label className="text-[11px] text-muted-foreground">Replace file contents</Label>
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
					))}
				</div>
			) : (
				<p className="text-xs text-muted-foreground">No secret files yet. Create one above.</p>
			)}
		</div>
	);
}
