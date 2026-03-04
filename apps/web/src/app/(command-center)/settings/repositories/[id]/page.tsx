"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import {
	useDeleteRepo,
	useRepo,
	useServiceCommands,
	useUpdateServiceCommands,
} from "@/hooks/org/use-repos";
import { useSecrets } from "@/hooks/org/use-secrets";
import {
	useActiveBaseline,
	useBaselineTargets,
	useLatestSetupSession,
	useMarkBaselineStale,
} from "@/hooks/sessions/use-baselines";
import { cn } from "@/lib/display/utils";
import { ArrowLeft, ExternalLink, Key, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

// ============================================
// Status display helpers
// ============================================

function BaselineStatusBadge({ status }: { status: string }) {
	const styles: Record<string, string> = {
		ready: "text-foreground",
		validating: "text-muted-foreground",
		stale: "text-muted-foreground",
		failed: "text-destructive",
	};

	const labels: Record<string, string> = {
		ready: "Ready",
		validating: "Validating",
		stale: "Stale",
		failed: "Failed",
	};

	return (
		<span className={cn("text-xs font-medium", styles[status] ?? "text-muted-foreground")}>
			{labels[status] ?? status}
		</span>
	);
}

function formatDate(dateStr: string | null | undefined): string {
	if (!dateStr) return "\u2014";
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

// ============================================
// Main Page
// ============================================

export default function RepoDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const repoId = params.id;

	const { data: repo, isLoading } = useRepo(repoId);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	if (!repo) {
		return (
			<div className="mx-auto max-w-3xl px-6 py-8">
				<p className="text-sm text-muted-foreground">Repository not found.</p>
				<Button
					variant="ghost"
					size="sm"
					className="mt-2"
					onClick={() => router.push("/settings/repositories")}
				>
					<ArrowLeft className="h-4 w-4 mr-1" />
					Back to repositories
				</Button>
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-3xl px-6 py-8 space-y-8">
				{/* Header */}
				<div>
					<button
						type="button"
						onClick={() => router.push("/settings/repositories")}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
					>
						<ArrowLeft className="h-3 w-3" />
						Repositories
					</button>
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-lg font-semibold">{repo.githubRepoName}</h1>
							<div className="flex items-center gap-3 mt-1">
								<span className="text-xs text-muted-foreground">
									{repo.defaultBranch || "main"}
								</span>
								<a
									href={repo.githubUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
								>
									<ExternalLink className="h-3 w-3" />
									GitHub
								</a>
							</div>
						</div>
					</div>
				</div>

				{/* Baseline */}
				<BaselineSection repoId={repoId} />

				{/* Environment */}
				<EnvironmentSection repoId={repoId} />

				{/* Service Commands */}
				<ServiceCommandsSection repoId={repoId} />

				{/* Latest Setup Session */}
				<SetupRunSection repoId={repoId} />

				{/* Danger Zone */}
				<DangerSection repoId={repoId} repoName={repo.githubRepoName} />
			</div>
		</div>
	);
}

// ============================================
// Baseline Section
// ============================================

function BaselineSection({ repoId }: { repoId: string }) {
	const { data: baseline, isLoading } = useActiveBaseline(repoId);
	const { data: targets } = useBaselineTargets(baseline?.id ?? "", !!baseline?.id);
	const markStale = useMarkBaselineStale();

	if (isLoading) {
		return (
			<section>
				<h2 className="text-sm font-medium mb-3">Baseline</h2>
				<LoadingDots size="sm" className="text-muted-foreground" />
			</section>
		);
	}

	if (!baseline) {
		return (
			<section>
				<h2 className="text-sm font-medium mb-3">Baseline</h2>
				<div className="rounded-lg border border-dashed border-border/80 py-6 text-center">
					<p className="text-sm text-muted-foreground">No active baseline</p>
					<p className="text-xs text-muted-foreground mt-1">
						Run setup to create a validated baseline for this repository.
					</p>
					<Button variant="outline" size="sm" className="mt-3 h-7 text-xs" asChild>
						<Link href={`/workspace/setup/${repoId}`}>Run Setup</Link>
					</Button>
				</div>
			</section>
		);
	}

	return (
		<section>
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-medium">Baseline</h2>
				{baseline.status === "ready" && (
					<Button
						variant="ghost"
						size="sm"
						className="h-7 text-xs text-muted-foreground"
						onClick={() => markStale.mutate({ baselineId: baseline.id })}
						disabled={markStale.isPending}
					>
						{markStale.isPending ? "Marking stale..." : "Force stale"}
					</Button>
				)}
			</div>
			<div className="rounded-lg border border-border/80 bg-background p-4 space-y-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<BaselineStatusBadge status={baseline.status} />
						{baseline.version && (
							<span className="text-xs text-muted-foreground">{baseline.version}</span>
						)}
					</div>
					<span className="text-xs text-muted-foreground">{formatDate(baseline.updatedAt)}</span>
				</div>

				{baseline.errorMessage && (
					<p className="text-xs text-destructive">{baseline.errorMessage}</p>
				)}

				{/* Targets */}
				{targets != null && targets.length > 0 ? (
					<div>
						<p className="text-xs text-muted-foreground mb-1.5">
							{targets.length} target{targets.length !== 1 ? "s" : ""}
						</p>
						<div className="space-y-1">
							{targets.map((target) => (
								<div key={target.id} className="text-xs py-0.5">
									<span className="font-medium">{target.name}</span>
									{target.description ? (
										<span className="text-muted-foreground ml-2">{target.description}</span>
									) : null}
								</div>
							))}
						</div>
					</div>
				) : null}

				{/* Commands summary */}
				{(baseline.installCommands || baseline.runCommands || baseline.testCommands) && (
					<div className="border-t border-border/50 pt-3">
						<p className="text-xs text-muted-foreground mb-1.5">Baseline commands</p>
						<div className="space-y-0.5 text-xs">
							{baseline.installCommands != null && (
								<div>
									<span className="text-muted-foreground">install:</span>{" "}
									<span className="font-mono">{JSON.stringify(baseline.installCommands)}</span>
								</div>
							)}
							{baseline.runCommands != null && (
								<div>
									<span className="text-muted-foreground">run:</span>{" "}
									<span className="font-mono">{JSON.stringify(baseline.runCommands)}</span>
								</div>
							)}
							{baseline.testCommands != null && (
								<div>
									<span className="text-muted-foreground">test:</span>{" "}
									<span className="font-mono">{JSON.stringify(baseline.testCommands)}</span>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Re-run setup */}
				{(baseline.status === "stale" || baseline.status === "failed") && (
					<div className="border-t border-border/50 pt-3">
						<Button variant="outline" size="sm" className="h-7 text-xs" asChild>
							<Link href={`/workspace/setup/${repoId}`}>Re-run Setup</Link>
						</Button>
					</div>
				)}
			</div>
		</section>
	);
}

// ============================================
// Setup Run Section
// ============================================

function SetupRunSection({ repoId }: { repoId: string }) {
	const { data: latestSession, isLoading } = useLatestSetupSession(repoId);

	if (isLoading) {
		return (
			<section>
				<h2 className="text-sm font-medium mb-3">Latest Setup Run</h2>
				<LoadingDots size="sm" className="text-muted-foreground" />
			</section>
		);
	}

	if (!latestSession) {
		return (
			<section>
				<h2 className="text-sm font-medium mb-3">Latest Setup Run</h2>
				<div className="rounded-lg border border-dashed border-border/80 py-6 text-center">
					<p className="text-sm text-muted-foreground">No setup runs yet</p>
				</div>
			</section>
		);
	}

	return (
		<section>
			<h2 className="text-sm font-medium mb-3">Latest Setup Run</h2>
			<div className="rounded-lg border border-border/80 bg-background p-4">
				<div className="flex items-center justify-between text-xs">
					<div className="flex items-center gap-3">
						<span className="font-medium">Session</span>
						<span className="text-muted-foreground">{latestSession.runtimeStatus}</span>
					</div>
					<span className="text-muted-foreground">{formatDate(latestSession.startedAt)}</span>
				</div>
			</div>
		</section>
	);
}

// ============================================
// Environment Section
// ============================================

function EnvironmentSection({ repoId }: { repoId: string }) {
	const { data: allSecrets, isLoading } = useSecrets();

	if (isLoading) {
		return (
			<section>
				<h2 className="text-sm font-medium mb-3">Environment</h2>
				<LoadingDots size="sm" className="text-muted-foreground" />
			</section>
		);
	}

	const secrets = allSecrets ?? [];
	const repoSecrets = secrets.filter((s) => s.repo_id === repoId);
	const orgSecrets = secrets.filter((s) => !s.repo_id);

	// Compute effective env: repo-scoped overrides org-scoped
	const orgKeys = new Set(orgSecrets.map((s) => s.key));
	const repoKeys = new Set(repoSecrets.map((s) => s.key));

	const hasSecrets = repoSecrets.length > 0 || orgSecrets.length > 0;

	return (
		<section>
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-medium">Environment</h2>
				<Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
					<Link href="/settings/secrets">Manage secrets</Link>
				</Button>
			</div>

			{!hasSecrets ? (
				<div className="rounded-lg border border-dashed border-border/80 py-6 text-center">
					<p className="text-sm text-muted-foreground">No secrets configured</p>
					<p className="text-xs text-muted-foreground mt-1">
						Secrets are injected at session start. Values are never exposed.
					</p>
				</div>
			) : (
				<div className="rounded-lg border border-border/80 bg-background p-4 space-y-3">
					<p className="text-xs text-muted-foreground">
						Secrets are injected at session start. Values are never exposed in the UI. Repo-scoped
						secrets take precedence over org-wide secrets.
					</p>

					{/* Repo-scoped secrets */}
					{repoSecrets.length > 0 && (
						<div>
							<p className="text-xs text-muted-foreground mb-1.5">
								Repo-scoped ({repoSecrets.length})
							</p>
							<div className="space-y-0.5">
								{repoSecrets.map((secret) => (
									<div key={secret.id} className="flex items-center gap-2 text-xs py-0.5">
										<Key className="h-3 w-3 text-muted-foreground shrink-0" />
										<span className="font-medium">{secret.key}</span>
										{secret.description && (
											<span className="text-muted-foreground truncate">{secret.description}</span>
										)}
									</div>
								))}
							</div>
						</div>
					)}

					{/* Org-wide secrets (excluding those overridden by repo-scoped) */}
					{orgSecrets.length > 0 && (
						<div>
							<p className="text-xs text-muted-foreground mb-1.5">Org-wide ({orgSecrets.length})</p>
							<div className="space-y-0.5">
								{orgSecrets.map((secret) => (
									<div key={secret.id} className="flex items-center gap-2 text-xs py-0.5">
										<Key className="h-3 w-3 text-muted-foreground shrink-0" />
										<span
											className={cn(
												"font-medium",
												repoKeys.has(secret.key) && "line-through text-muted-foreground",
											)}
										>
											{secret.key}
										</span>
										{repoKeys.has(secret.key) && (
											<span className="text-muted-foreground">(overridden)</span>
										)}
										{secret.description && !repoKeys.has(secret.key) && (
											<span className="text-muted-foreground truncate">{secret.description}</span>
										)}
									</div>
								))}
							</div>
						</div>
					)}
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

function ServiceCommandsSection({ repoId }: { repoId: string }) {
	const { data: commands, isLoading } = useServiceCommands(repoId);
	const updateCommands = useUpdateServiceCommands();
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
			id: repoId,
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
		return (
			<section>
				<h2 className="text-sm font-medium mb-3">Auto-start Commands</h2>
				<LoadingDots size="sm" className="text-muted-foreground" />
			</section>
		);
	}

	return (
		<section>
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-medium">Auto-start Commands</h2>
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
						Default auto-start commands. Run automatically when a session starts.
					</p>
					{drafts.map((draft, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: draft list keyed by position
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
							// biome-ignore lint/suspicious/noArrayIndexKey: display-only list
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
					<p className="text-sm text-muted-foreground">No auto-start commands configured</p>
				</div>
			)}
		</section>
	);
}

// ============================================
// Danger Section
// ============================================

function DangerSection({ repoId, repoName }: { repoId: string; repoName: string }) {
	const deleteRepo = useDeleteRepo();
	const router = useRouter();
	const [deleteOpen, setDeleteOpen] = useState(false);

	const handleDelete = async () => {
		await deleteRepo.mutateAsync({ id: repoId });
		router.push("/settings/repositories");
	};

	return (
		<section>
			<h2 className="text-sm font-medium mb-3">Danger Zone</h2>
			<div className="rounded-lg border border-destructive/30 bg-background p-4">
				<div className="flex items-center justify-between">
					<div>
						<p className="text-sm font-medium">Delete repository</p>
						<p className="text-xs text-muted-foreground mt-0.5">
							Remove this repository and all its baselines from the organization.
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
						onClick={() => setDeleteOpen(true)}
					>
						Delete
					</Button>
				</div>
			</div>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete repository</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to remove {repoName}? This will delete all baselines and targets
							associated with this repository.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deleteRepo.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
