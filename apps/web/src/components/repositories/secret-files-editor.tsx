"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDeleteSecretFile, useSecretFiles, useUpsertSecretFile } from "@/hooks/use-secret-files";
import { FileLock2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

interface SecretFilesEditorProps {
	configurationId: string;
	initialCreateOpen?: boolean;
	callToActionLabel?: string;
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

	const handleAdd = async () => {
		if (!newPath.trim() || !newContent.trim()) return;
		await upsertFile.mutateAsync({
			configurationId,
			filePath: newPath.trim(),
			content: newContent,
		});
		setNewPath("");
		setNewContent("");
		setAdding(false);
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
				{!adding && (
					<Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAdding(true)}>
						<Plus className="h-3 w-3 mr-1" />
						{callToActionLabel}
					</Button>
				)}
			</div>

			<p className="text-[11px] text-muted-foreground">
				Create a file path inside the repo and paste its full contents. Proliferate writes this file
				for setup and future sessions.
			</p>
			<p className="text-[11px] text-muted-foreground">
				Secret file values are encrypted at rest and never shown again after save.
			</p>

			{/* Existing files */}
			{files.length > 0 ? (
				<div className="space-y-1.5">
					{files.map((file) => (
						<div key={file.id} className="rounded-md border border-border/60 p-2.5">
							<div className="flex items-center justify-between mb-1">
								<code className="text-xs font-mono">{file.filePath}</code>
								<div className="flex items-center gap-1">
									<Button
										variant="ghost"
										size="sm"
										className="h-6 text-xs"
										onClick={() => {
											if (editingId === file.id) {
												setEditingId(null);
											} else {
												setEditingId(file.id);
												setEditContent("");
											}
										}}
									>
										{editingId === file.id ? "Cancel" : "Replace content"}
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
							{editingId === file.id ? (
								<div className="space-y-2 mt-2">
									<Textarea
										value={editContent}
										onChange={(e) => setEditContent(e.target.value)}
										placeholder="Enter new content (current value is hidden)"
										className="text-xs font-mono min-h-[80px]"
									/>
									<Button
										size="sm"
										className="h-7 text-xs"
										onClick={() => handleUpdate(file.filePath)}
										disabled={upsertFile.isPending || !editContent.trim()}
									>
										{upsertFile.isPending ? "Saving..." : "Save"}
									</Button>
								</div>
							) : (
								<p className="text-xs text-muted-foreground italic">Value hidden for security</p>
							)}
						</div>
					))}
				</div>
			) : !adding ? (
				<p className="text-xs text-muted-foreground">No secret files configured.</p>
			) : null}

			{/* Add new file */}
			{adding && (
				<div className="rounded-md border border-border/60 p-2.5 space-y-2">
					<div className="space-y-1">
						<Label className="text-[11px] text-muted-foreground">File path in project</Label>
						<Input
							value={newPath}
							onChange={(e) => setNewPath(e.target.value)}
							placeholder="Path in repo (e.g. .env.local, apps/api/.env)"
							className="h-7 text-xs font-mono"
						/>
					</div>
					<div className="space-y-1">
						<Label className="text-[11px] text-muted-foreground">File contents</Label>
						<Textarea
							value={newContent}
							onChange={(e) => setNewContent(e.target.value)}
							placeholder="Paste file contents"
							className="text-xs font-mono min-h-[80px]"
						/>
					</div>
					<div className="flex gap-2">
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-xs"
							onClick={() => {
								setAdding(false);
								setNewPath("");
								setNewContent("");
							}}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							className="h-7 text-xs"
							onClick={handleAdd}
							disabled={upsertFile.isPending || !newPath.trim() || !newContent.trim()}
						>
							{upsertFile.isPending ? "Saving..." : "Add File"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
