"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import {
	useConfigurationServiceCommands,
	useConfigurations,
	useDetachRepo,
	useUpdateConfigurationServiceCommands,
} from "@/hooks/use-configurations";
import { cn } from "@/lib/utils";
import { ArrowLeft, FolderGit2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export default function ConfigurationDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const configurationId = params.id;

	const { data: configurations, isLoading } = useConfigurations();

	const config = useMemo(() => {
		return configurations?.find((c) => c.id === configurationId);
	}, [configurations, configurationId]);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	if (!config) {
		return (
			<div className="mx-auto max-w-3xl px-6 py-8">
				<p className="text-sm text-muted-foreground">Configuration not found.</p>
				<Button
					variant="ghost"
					size="sm"
					className="mt-2"
					onClick={() => router.push("/dashboard/configurations")}
				>
					<ArrowLeft className="h-4 w-4 mr-1" />
					Back to configurations
				</Button>
			</div>
		);
	}

	const displayName = config.name || "Untitled configuration";
	const repos = (config.configurationRepos ?? []).filter((cr) => cr.repo !== null);

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-3xl px-6 py-8 space-y-8">
				{/* Header */}
				<div>
					<button
						type="button"
						onClick={() => router.push("/dashboard/configurations")}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
					>
						<ArrowLeft className="h-3 w-3" />
						Configurations
					</button>
					<h1 className="text-lg font-semibold">{displayName}</h1>
					<div className="flex items-center gap-2 mt-1">
						<span
							className={cn(
								"inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11px] font-medium",
								config.status === "ready"
									? "border-border/50 bg-muted/50 text-foreground"
									: "border-border/50 bg-muted/50 text-muted-foreground",
							)}
						>
							{config.status === "ready"
								? "Ready"
								: config.status === "building"
									? "Building"
									: "Pending"}
						</span>
					</div>
				</div>

				{/* Attached repos */}
				<AttachedReposSection configurationId={configurationId} repos={repos} />

				{/* Service Commands */}
				<ServiceCommandsSection configurationId={configurationId} />
			</div>
		</div>
	);
}

// ============================================
// Attached Repos Section
// ============================================

interface ConfigurationRepo {
	workspacePath: string;
	repo: {
		id: string;
		githubRepoName: string;
		githubUrl: string;
	} | null;
}

function AttachedReposSection({
	configurationId,
	repos,
}: {
	configurationId: string;
	repos: ConfigurationRepo[];
}) {
	const detachRepo = useDetachRepo();

	const handleDetach = async (repoId: string) => {
		await detachRepo.mutateAsync({ configurationId, repoId });
	};

	return (
		<section>
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-medium">Attached Repositories</h2>
			</div>

			{repos.length > 0 ? (
				<div className="rounded-lg border border-border/80 bg-background divide-y divide-border/60">
					{repos.map((cr) => (
						<div key={cr.repo!.id} className="flex items-center justify-between px-4 py-2.5">
							<div className="flex items-center gap-2 min-w-0">
								<FolderGit2 className="h-4 w-4 text-muted-foreground shrink-0" />
								<span className="text-sm truncate">{cr.repo!.githubRepoName}</span>
								{cr.workspacePath && (
									<span className="text-xs text-muted-foreground">{cr.workspacePath}</span>
								)}
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs text-muted-foreground hover:text-destructive shrink-0"
								onClick={() => handleDetach(cr.repo!.id)}
								disabled={detachRepo.isPending}
							>
								<X className="h-3 w-3 mr-1" />
								Detach
							</Button>
						</div>
					))}
				</div>
			) : (
				<div className="rounded-lg border border-dashed border-border/80 py-8 text-center">
					<p className="text-sm text-muted-foreground">No repositories attached</p>
					<p className="text-xs text-muted-foreground mt-1">
						Attach repositories from the repos page or via the API
					</p>
				</div>
			)}
		</section>
	);
}

// ============================================
// Service Commands Section
// ============================================

interface CommandDraft {
	name: string;
	command: string;
	cwd: string;
}

function ServiceCommandsSection({ configurationId }: { configurationId: string }) {
	const { data: commands, isLoading } = useConfigurationServiceCommands(configurationId);
	const updateCommands = useUpdateConfigurationServiceCommands();
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
		await updateCommands.mutateAsync({
			configurationId,
			commands: valid.map((d) => ({
				name: d.name.trim(),
				command: d.command.trim(),
				...(d.cwd.trim() ? { cwd: d.cwd.trim() } : {}),
			})),
		});
		setEditing(false);
	};

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

	if (isLoading) {
		return <LoadingDots size="sm" className="text-muted-foreground" />;
	}

	return (
		<section>
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-medium">Service Commands</h2>
				{!editing && (
					<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={startEditing}>
						<Pencil className="h-3 w-3 mr-1" />
						{commands && commands.length > 0 ? "Edit" : "Add commands"}
					</Button>
				)}
			</div>

			{editing ? (
				<div className="space-y-2">
					<p className="text-xs text-muted-foreground">
						Service commands run automatically when a session starts with this configuration.
					</p>
					{drafts.map((draft, index) => (
						<div key={index} className="flex items-start gap-2">
							<div className="flex-1 space-y-1.5">
								<Input
									value={draft.name}
									onChange={(e) => updateDraft(index, "name", e.target.value)}
									placeholder="Name (e.g. dev-server)"
									className="h-7 text-xs"
								/>
								<Input
									value={draft.command}
									onChange={(e) => updateDraft(index, "command", e.target.value)}
									placeholder="Command (e.g. pnpm dev)"
									className="h-7 text-xs font-mono"
								/>
								<Input
									value={draft.cwd}
									onChange={(e) => updateDraft(index, "cwd", e.target.value)}
									placeholder="Working directory (optional)"
									className="h-7 text-xs"
								/>
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
								onClick={() => removeRow(index)}
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
							onClick={addRow}
							disabled={drafts.length >= 10}
						>
							<Plus className="h-3 w-3 mr-1" />
							Add command
						</Button>
						<div className="flex-1" />
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-xs"
							onClick={() => setEditing(false)}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							className="h-7 text-xs"
							onClick={handleSave}
							disabled={updateCommands.isPending}
						>
							{updateCommands.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
				</div>
			) : commands && commands.length > 0 ? (
				<div className="rounded-lg border border-border/80 bg-background p-3">
					<div className="space-y-1">
						{commands.map((cmd, index) => (
							<div key={index} className="text-xs py-0.5">
								<span className="font-medium">{cmd.name}</span>
								<span className="text-muted-foreground ml-2 font-mono">{cmd.command}</span>
								{cmd.cwd && <span className="text-muted-foreground ml-2">({cmd.cwd})</span>}
							</div>
						))}
					</div>
				</div>
			) : (
				<div className="rounded-lg border border-dashed border-border/80 py-6 text-center">
					<p className="text-sm text-muted-foreground">No service commands configured</p>
				</div>
			)}
		</section>
	);
}
