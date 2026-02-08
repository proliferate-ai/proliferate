"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
	usePrebuildServiceCommands,
	useServiceCommands,
	useUpdatePrebuildServiceCommands,
	useUpdateServiceCommands,
} from "@/hooks/use-repos";
import { Pencil, Play, Plus, Settings, Trash2, X } from "lucide-react";
import { useState } from "react";

interface AutoStartPanelProps {
	repoId?: string | null;
	prebuildId?: string | null;
	onClose: () => void;
}

interface CommandDraft {
	name: string;
	command: string;
	cwd: string;
}

export function AutoStartPanel({ repoId, prebuildId, onClose }: AutoStartPanelProps) {
	// Prefer prebuild-level commands when available, fall back to repo-level
	const usePrebuild = !!prebuildId;
	const { data: prebuildCommands, isLoading: prebuildLoading } = usePrebuildServiceCommands(
		prebuildId || "",
		usePrebuild,
	);
	const { data: repoCommands, isLoading: repoLoading } = useServiceCommands(
		repoId || "",
		!usePrebuild && !!repoId,
	);
	const updatePrebuildCommands = useUpdatePrebuildServiceCommands();
	const updateRepoCommands = useUpdateServiceCommands();

	const commands = usePrebuild ? prebuildCommands : repoCommands;
	const isLoading = usePrebuild ? prebuildLoading : repoLoading;
	const canEdit = usePrebuild ? !!prebuildId : !!repoId;

	const [editing, setEditing] = useState(false);
	const [drafts, setDrafts] = useState<CommandDraft[]>([]);

	const startEditing = () => {
		setDrafts(
			commands?.length
				? commands.map((c) => ({ name: c.name, command: c.command, cwd: c.cwd || "" }))
				: [{ name: "", command: "", cwd: "" }],
		);
		setEditing(true);
	};

	const handleSave = async () => {
		const valid = drafts.filter((d) => d.name.trim() && d.command.trim());
		const cmds = valid.map((d) => ({
			name: d.name.trim(),
			command: d.command.trim(),
			...(d.cwd.trim() ? { cwd: d.cwd.trim() } : {}),
		}));

		if (usePrebuild && prebuildId) {
			await updatePrebuildCommands.mutateAsync({ prebuildId, commands: cmds });
		} else if (repoId) {
			await updateRepoCommands.mutateAsync({ id: repoId, commands: cmds });
		}
		setEditing(false);
	};

	const isSaving = updatePrebuildCommands.isPending || updateRepoCommands.isPending;

	const addRow = () => {
		if (drafts.length >= 10) return;
		setDrafts([...drafts, { name: "", command: "", cwd: "" }]);
	};

	const removeRow = (index: number) => {
		setDrafts(drafts.filter((_, i) => i !== index));
	};

	const updateDraft = (index: number, field: keyof CommandDraft, value: string) => {
		setDrafts(drafts.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
	};

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<TooltipProvider delayDuration={150}>
				<div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
					<span className="text-sm font-medium">Auto-start</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
								<X className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Close panel</TooltipContent>
					</Tooltip>
				</div>
			</TooltipProvider>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				<p className="text-xs text-muted-foreground">
					These commands run automatically when future sessions start from a saved environment
					snapshot.
				</p>

				{!canEdit ? (
					<div className="rounded-lg border border-dashed border-border/80 p-4 text-center">
						<Settings className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
						<p className="text-sm text-muted-foreground">
							No configuration linked to this session.
						</p>
					</div>
				) : isLoading ? (
					<div className="py-4 text-center">
						<LoadingDots size="sm" className="text-muted-foreground" />
					</div>
				) : editing ? (
					<EditForm
						drafts={drafts}
						onUpdateDraft={updateDraft}
						onAddRow={addRow}
						onRemoveRow={removeRow}
						onSave={handleSave}
						onCancel={() => setEditing(false)}
						isSaving={isSaving}
					/>
				) : commands && commands.length > 0 ? (
					<CommandsList commands={commands} onEdit={startEditing} />
				) : (
					<EmptyState onAdd={startEditing} />
				)}
			</div>
		</div>
	);
}

function CommandsList({
	commands,
	onEdit,
}: {
	commands: Array<{ name: string; command: string; cwd?: string }>;
	onEdit: () => void;
}) {
	return (
		<div className="space-y-2">
			{commands.map((cmd, index) => (
				<div
					key={`${cmd.name}-${index}`}
					className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50 border border-border/60"
				>
					<Play className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
					<div className="flex-1 min-w-0">
						<p className="text-xs font-medium truncate">{cmd.name}</p>
						<p className="text-xs text-muted-foreground font-mono truncate">{cmd.command}</p>
						{cmd.cwd && (
							<p className="text-[10px] text-muted-foreground truncate">cwd: {cmd.cwd}</p>
						)}
					</div>
				</div>
			))}
			<Button variant="outline" size="sm" className="w-full mt-1" onClick={onEdit}>
				<Pencil className="h-3 w-3 mr-2" />
				Edit commands
			</Button>
		</div>
	);
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
	return (
		<div className="text-center py-6">
			<Play className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
			<p className="text-sm text-muted-foreground mb-1">No auto-start commands</p>
			<p className="text-xs text-muted-foreground mb-3">
				Add commands to auto-run when sessions start
			</p>
			<Button variant="outline" size="sm" onClick={onAdd}>
				<Plus className="h-3.5 w-3.5 mr-2" />
				Add commands
			</Button>
		</div>
	);
}

function EditForm({
	drafts,
	onUpdateDraft,
	onAddRow,
	onRemoveRow,
	onSave,
	onCancel,
	isSaving,
}: {
	drafts: CommandDraft[];
	onUpdateDraft: (index: number, field: keyof CommandDraft, value: string) => void;
	onAddRow: () => void;
	onRemoveRow: (index: number) => void;
	onSave: () => void;
	onCancel: () => void;
	isSaving: boolean;
}) {
	return (
		<div className="space-y-3">
			{drafts.map((draft, index) => (
				<div key={index} className="flex items-start gap-2">
					<div className="flex-1 space-y-1.5">
						<Input
							value={draft.name}
							onChange={(e) => onUpdateDraft(index, "name", e.target.value)}
							placeholder="Name (e.g. dev-server)"
							className="h-7 text-xs"
						/>
						<Input
							value={draft.command}
							onChange={(e) => onUpdateDraft(index, "command", e.target.value)}
							placeholder="Command (e.g. pnpm dev)"
							className="h-7 text-xs font-mono"
						/>
						<Input
							value={draft.cwd}
							onChange={(e) => onUpdateDraft(index, "cwd", e.target.value)}
							placeholder="Working directory (optional, relative)"
							className="h-7 text-xs"
						/>
					</div>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
						onClick={() => onRemoveRow(index)}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
				</div>
			))}
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-7 text-xs"
					onClick={onAddRow}
					disabled={drafts.length >= 10}
				>
					<Plus className="h-3 w-3 mr-1" />
					Add command
				</Button>
				<div className="flex-1" />
				<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
					Cancel
				</Button>
				<Button size="sm" className="h-7 text-xs" onClick={onSave} disabled={isSaving}>
					{isSaving ? "Saving..." : "Save"}
				</Button>
			</div>
		</div>
	);
}
