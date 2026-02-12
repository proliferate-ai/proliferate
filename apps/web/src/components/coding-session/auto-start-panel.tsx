"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
	useEffectiveServiceCommands,
	useServiceCommands,
	useUpdatePrebuildServiceCommands,
	useUpdateServiceCommands,
} from "@/hooks/use-repos";
import type {
	AutoStartOutputEntry,
	AutoStartOutputMessage,
	PrebuildServiceCommand,
} from "@proliferate/shared";
import {
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	FolderOpen,
	Pencil,
	Play,
	Plus,
	Settings,
	Trash2,
	X,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface AutoStartPanelProps {
	repoId?: string | null;
	prebuildId?: string | null;
	onClose: () => void;
	autoStartOutput?: AutoStartOutputMessage["payload"] | null;
	sendRunAutoStart?: (
		runId: string,
		mode?: "test" | "start",
		commands?: PrebuildServiceCommand[],
	) => void;
}

export interface AutoStartContentProps {
	repoId?: string | null;
	prebuildId?: string | null;
	autoStartOutput?: AutoStartOutputMessage["payload"] | null;
	sendRunAutoStart?: (
		runId: string,
		mode?: "test" | "start",
		commands?: PrebuildServiceCommand[],
	) => void;
}

interface CommandDraft {
	name: string;
	command: string;
	cwd: string;
	workspacePath: string;
}

export function AutoStartContent({
	repoId,
	prebuildId,
	autoStartOutput,
	sendRunAutoStart,
}: AutoStartContentProps) {
	const hasPrebuild = !!prebuildId;

	// Effective commands (server-side resolved) when prebuild exists
	const { data: effective, isLoading: effectiveLoading } = useEffectiveServiceCommands(
		prebuildId || "",
		hasPrebuild,
	);

	// Fallback: repo-level commands when no prebuild
	const { data: repoCommands, isLoading: repoLoading } = useServiceCommands(
		repoId || "",
		!hasPrebuild && !!repoId,
	);

	const updatePrebuildCommands = useUpdatePrebuildServiceCommands();
	const updateRepoCommands = useUpdateServiceCommands();

	const commands = hasPrebuild ? effective?.commands : repoCommands;
	const source = hasPrebuild
		? (effective?.source ?? "none")
		: repoCommands?.length
			? "repo"
			: "none";
	const workspaces = effective?.workspaces ?? [];
	const isLoading = hasPrebuild ? effectiveLoading : repoLoading;
	const canEdit = hasPrebuild ? !!prebuildId : !!repoId;

	const [editing, setEditing] = useState(false);
	const [drafts, setDrafts] = useState<CommandDraft[]>([]);
	const [isTesting, setIsTesting] = useState(false);

	const startEditing = () => {
		setDrafts(
			commands?.length
				? commands.map((c) => ({
						name: c.name,
						command: c.command,
						cwd: c.cwd || "",
						workspacePath: ("workspacePath" in c ? (c.workspacePath as string) : undefined) || "",
					}))
				: [{ name: "", command: "", cwd: "", workspacePath: "" }],
		);
		setEditing(true);
	};

	const handleSave = async () => {
		const valid = drafts.filter((d) => d.name.trim() && d.command.trim());
		const cmds = valid.map((d) => ({
			name: d.name.trim(),
			command: d.command.trim(),
			...(d.cwd.trim() ? { cwd: d.cwd.trim() } : {}),
			...(d.workspacePath.trim() ? { workspacePath: d.workspacePath.trim() } : {}),
		}));

		if (hasPrebuild && prebuildId) {
			// Promotion model: editing always writes to prebuild
			await updatePrebuildCommands.mutateAsync({ prebuildId, commands: cmds });
		} else if (repoId) {
			// No prebuild — save to repo (commands without workspacePath)
			const repoCmds = cmds.map(({ workspacePath: _, ...rest }) => rest);
			await updateRepoCommands.mutateAsync({ id: repoId, commands: repoCmds });
		}
		setEditing(false);
	};

	const handleTest = useCallback(() => {
		if (!sendRunAutoStart) return;
		const runId = crypto.randomUUID();
		setIsTesting(true);
		const cmds = drafts
			.filter((d) => d.name.trim() && d.command.trim())
			.map((d) => ({
				name: d.name.trim(),
				command: d.command.trim(),
				...(d.cwd.trim() ? { cwd: d.cwd.trim() } : {}),
				...(d.workspacePath.trim() ? { workspacePath: d.workspacePath.trim() } : {}),
			}));
		sendRunAutoStart(runId, "test", cmds);
	}, [sendRunAutoStart, drafts]);

	// Clear testing state when results arrive
	useEffect(() => {
		if (isTesting && autoStartOutput) {
			setIsTesting(false);
		}
	}, [isTesting, autoStartOutput]);

	const isSaving = updatePrebuildCommands.isPending || updateRepoCommands.isPending;

	const addRow = () => {
		if (drafts.length >= 10) return;
		setDrafts([
			...drafts,
			{
				name: "",
				command: "",
				cwd: "",
				workspacePath: workspaces.length === 1 ? workspaces[0] : "",
			},
		]);
	};

	const removeRow = (index: number) => {
		setDrafts(drafts.filter((_, i) => i !== index));
	};

	const updateDraft = (index: number, field: keyof CommandDraft, value: string) => {
		setDrafts(drafts.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
	};

	return (
		<div className="flex-1 overflow-y-auto p-4 space-y-4">
			<p className="text-xs text-muted-foreground">
				These commands run automatically when future sessions start from a saved environment
				snapshot.
			</p>

			{source !== "none" && !editing && (
				<p className="text-[10px] text-muted-foreground/70">
					{source === "prebuild"
						? "Using configuration overrides"
						: "Using repo defaults — saving will create configuration overrides"}
				</p>
			)}

			{!canEdit ? (
				<div className="rounded-lg border border-dashed border-border/80 p-4 text-center">
					<Settings className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
					<p className="text-sm text-muted-foreground">No configuration linked to this session.</p>
				</div>
			) : isLoading ? (
				<div className="py-4 text-center">
					<LoadingDots size="sm" className="text-muted-foreground" />
				</div>
			) : editing ? (
				<EditForm
					drafts={drafts}
					workspaces={workspaces}
					onUpdateDraft={updateDraft}
					onAddRow={addRow}
					onRemoveRow={removeRow}
					onSave={handleSave}
					onCancel={() => setEditing(false)}
					isSaving={isSaving}
				/>
			) : commands && commands.length > 0 ? (
				<>
					<CommandsList commands={commands} onEdit={startEditing} />
					{sendRunAutoStart && (
						<Button
							variant="outline"
							size="sm"
							className="w-full"
							onClick={handleTest}
							disabled={isTesting}
						>
							{isTesting ? (
								<>
									<LoadingDots size="sm" className="mr-2" />
									Testing...
								</>
							) : (
								<>
									<Play className="h-3 w-3 mr-2" />
									Test auto-start
								</>
							)}
						</Button>
					)}
					{autoStartOutput && <TestResults entries={autoStartOutput.entries} />}
				</>
			) : (
				<EmptyState onAdd={startEditing} />
			)}
		</div>
	);
}

export function AutoStartPanel({
	repoId,
	prebuildId,
	onClose,
	autoStartOutput,
	sendRunAutoStart,
}: AutoStartPanelProps) {
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

			<AutoStartContent
				repoId={repoId}
				prebuildId={prebuildId}
				autoStartOutput={autoStartOutput}
				sendRunAutoStart={sendRunAutoStart}
			/>
		</div>
	);
}

function CommandsList({
	commands,
	onEdit,
}: {
	commands: Array<{ name: string; command: string; cwd?: string; workspacePath?: string }>;
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
						{cmd.workspacePath && cmd.workspacePath !== "." && (
							<p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
								<FolderOpen className="h-2.5 w-2.5 inline" />
								{cmd.workspacePath}
							</p>
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

function TestResults({ entries }: { entries: AutoStartOutputEntry[] }) {
	return (
		<div className="space-y-2">
			<p className="text-xs font-medium text-muted-foreground">Test results</p>
			{entries.map((entry, index) => (
				<TestResultEntry key={`${entry.name}-${index}`} entry={entry} />
			))}
		</div>
	);
}

function TestResultEntry({ entry }: { entry: AutoStartOutputEntry }) {
	const [expanded, setExpanded] = useState(false);
	const passed = entry.exitCode === 0;

	return (
		<div className="rounded-md border border-border/60 overflow-hidden">
			<button
				type="button"
				className="flex items-center gap-2 w-full p-2 text-left hover:bg-muted/30 transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
				{passed ? (
					<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
				) : (
					<XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
				)}
				<span className="text-xs font-medium flex-1 truncate">{entry.name}</span>
				<span className="text-[10px] text-muted-foreground">exit {entry.exitCode ?? "?"}</span>
				{expanded ? (
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				) : (
					<ChevronRight className="h-3 w-3 text-muted-foreground" />
				)}
			</button>
			{expanded && (
				<div className="border-t border-border/40 p-2 space-y-1">
					{entry.output && (
						<pre className="text-[10px] font-mono text-muted-foreground bg-muted/30 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">
							{entry.output}
						</pre>
					)}
					{entry.logFile && (
						<p className="text-[10px] text-muted-foreground">Log: {entry.logFile}</p>
					)}
					{entry.cwd && <p className="text-[10px] text-muted-foreground">cwd: {entry.cwd}</p>}
				</div>
			)}
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
	workspaces,
	onUpdateDraft,
	onAddRow,
	onRemoveRow,
	onSave,
	onCancel,
	isSaving,
}: {
	drafts: CommandDraft[];
	workspaces: string[];
	onUpdateDraft: (index: number, field: keyof CommandDraft, value: string) => void;
	onAddRow: () => void;
	onRemoveRow: (index: number) => void;
	onSave: () => void;
	onCancel: () => void;
	isSaving: boolean;
}) {
	const showWorkspace = workspaces.length > 1;

	return (
		<div className="space-y-3">
			{drafts.map((draft, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: draft items have no stable ID
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
						{showWorkspace && (
							<Select
								value={draft.workspacePath || undefined}
								onValueChange={(v) => onUpdateDraft(index, "workspacePath", v)}
							>
								<SelectTrigger className="h-7 text-xs">
									<SelectValue placeholder="Workspace" />
								</SelectTrigger>
								<SelectContent>
									{workspaces.map((ws) => (
										<SelectItem key={ws} value={ws} className="text-xs">
											{ws}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
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
