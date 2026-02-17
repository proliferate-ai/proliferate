"use client";

import { openEditSession, openHistoricalSession } from "@/components/coding-session";
import { SecretFilesEditor } from "@/components/repositories/secret-files-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useOrgMembers } from "@/hooks/use-orgs";
import { useRepo, useServiceCommands, useUpdateServiceCommands } from "@/hooks/use-repos";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";
import { type OrgRole, hasRoleOrHigher } from "@/lib/roles";
import { getSnapshotDisplayName } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function RepoDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const repoId = params.id;

	const { data: repo, isLoading } = useRepo(repoId);

	// Role gating for secret files
	const { data: activeOrg } = useActiveOrganization();
	const { data: authSession } = useSession();
	const currentUserId = authSession?.user?.id;
	const { data: members } = useOrgMembers(activeOrg?.id ?? "");
	const currentUserRole = members?.find((m: { userId: string }) => m.userId === currentUserId)
		?.role as OrgRole | undefined;
	const isAdmin = currentUserRole ? hasRoleOrHigher(currentUserRole, "admin") : false;

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
					onClick={() => router.push("/dashboard/repos")}
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
						onClick={() => router.push("/dashboard/repos")}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
					>
						<ArrowLeft className="h-3 w-3" />
						Repositories
					</button>
					<h1 className="text-lg font-semibold">{repo.githubRepoName}</h1>
					<div className="flex items-center gap-2 mt-1">
						<span className="text-xs text-muted-foreground">{repo.defaultBranch || "main"}</span>
						<span className="inline-flex items-center rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
							{repo.prebuildStatus === "ready" ? "Configured" : "Not configured"}
						</span>
					</div>
				</div>

				{/* Configurations */}
				<ConfigurationsSection repoId={repoId} isAdmin={isAdmin} />

				{/* Service Commands */}
				<ServiceCommandsSection repoId={repoId} />
			</div>
		</div>
	);
}

function ConfigurationsSection({ repoId, isAdmin }: { repoId: string; isAdmin: boolean }) {
	const router = useRouter();
	const { data: snapshotsData, isLoading } = useQuery({
		...orpc.repos.listSnapshots.queryOptions({ input: { id: repoId } }),
	});
	const snapshots = snapshotsData?.prebuilds;

	const [expandedId, setExpandedId] = useState<string | null>(null);

	return (
		<section>
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-medium">Configurations</h2>
				<Button
					variant="outline"
					size="sm"
					className="h-7 text-xs"
					onClick={() => router.push(`/workspace/new?repoId=${repoId}&type=setup`)}
				>
					<Plus className="h-3 w-3 mr-1" />
					New configuration
				</Button>
			</div>

			{isLoading ? (
				<LoadingDots size="sm" className="text-muted-foreground" />
			) : snapshots && snapshots.length > 0 ? (
				<div className="rounded-lg border border-border/80 bg-background divide-y divide-border/60">
					{snapshots.map((snapshot) => {
						const setupSessionId = snapshot.setupSessions?.find(
							(s) => s.sessionType === "setup",
						)?.id;
						const isExpanded = expandedId === snapshot.id;

						return (
							<div key={snapshot.id}>
								<div className="flex items-center justify-between px-4 py-2.5">
									<button
										type="button"
										className="text-sm truncate hover:underline text-left flex-1 min-w-0"
										onClick={() => {
											if (setupSessionId) {
												openHistoricalSession(setupSessionId, getSnapshotDisplayName(snapshot));
											}
										}}
									>
										{getSnapshotDisplayName(snapshot)}
									</button>
									<div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
										{setupSessionId && (
											<Button
												variant="ghost"
												size="sm"
												className="h-7 text-xs"
												onClick={() =>
													openEditSession({
														sessionId: setupSessionId,
														snapshotId: snapshot.id,
														snapshotName: getSnapshotDisplayName(snapshot),
														prebuildId: snapshot.id,
													})
												}
											>
												<Pencil className="h-3 w-3 mr-1" />
												Edit
											</Button>
										)}
										{isAdmin && (
											<Button
												variant="ghost"
												size="sm"
												className="h-7 text-xs"
												onClick={() => setExpandedId(isExpanded ? null : snapshot.id)}
											>
												{isExpanded ? "Hide Secrets" : "Secret Files"}
											</Button>
										)}
									</div>
								</div>

								{isAdmin && isExpanded && (
									<div className="px-4 pb-3 border-t border-border/40 pt-3">
										<SecretFilesEditor configurationId={snapshot.id} />
									</div>
								)}
							</div>
						);
					})}
				</div>
			) : (
				<div className="rounded-lg border border-dashed border-border/80 py-8 text-center">
					<p className="text-sm text-muted-foreground">No configurations yet</p>
					<p className="text-xs text-muted-foreground mt-1">
						Create a configuration to get started
					</p>
				</div>
			)}
		</section>
	);
}

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
		return <LoadingDots size="sm" className="text-muted-foreground" />;
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
					<p className="text-sm text-muted-foreground">No auto-start commands configured</p>
				</div>
			)}
		</section>
	);
}
