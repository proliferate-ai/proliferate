"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { PreviewMode } from "@/stores/preview-panel";
import type { GitResultMessage, GitState } from "@proliferate/shared";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	GitBranch,
	GitCommit,
	GitPullRequest,
	Loader2,
	Plus,
	Upload,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChangesContent } from "./changes-panel";
import { PanelShell } from "./panel-shell";

interface GitPanelProps {
	panelMode: PreviewMode;
	sessionId?: string;
	activityTick?: number;
	gitState: GitState | null;
	gitResult: GitResultMessage["payload"] | null;
	sendGetGitStatus?: (workspacePath?: string) => void;
	sendGitCreateBranch?: (branchName: string, workspacePath?: string) => void;
	sendGitCommit?: (
		message: string,
		opts?: { includeUntracked?: boolean; files?: string[]; workspacePath?: string },
	) => void;
	sendGitPush?: (workspacePath?: string) => void;
	sendGitCreatePr?: (
		title: string,
		body?: string,
		baseBranch?: string,
		workspacePath?: string,
	) => void;
	clearGitResult?: () => void;
}

export function GitPanel({
	panelMode,
	sessionId,
	activityTick,
	gitState,
	gitResult,
	sendGetGitStatus,
	sendGitCreateBranch,
	sendGitCommit,
	sendGitPush,
	sendGitCreatePr,
	clearGitResult,
}: GitPanelProps) {
	const defaultTab = panelMode.type === "git" && panelMode.tab ? panelMode.tab : "git";
	// Polling
	const pollPending = useRef(false);
	const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
	const [pollError, setPollError] = useState<string | null>(null);

	const requestStatus = useCallback(() => {
		if (pollPending.current || !sendGetGitStatus) return;
		pollPending.current = true;
		sendGetGitStatus();
	}, [sendGetGitStatus]);

	// Clear pending flag + poll error when we get a successful status update
	useEffect(() => {
		if (gitState) {
			pollPending.current = false;
			setPollError(null);
		}
	}, [gitState]);

	useEffect(() => {
		if (gitResult) pollPending.current = false;
	}, [gitResult]);

	// Request on mount + poll every 5s
	useEffect(() => {
		requestStatus();
		pollInterval.current = setInterval(requestStatus, 5000);
		return () => {
			if (pollInterval.current) clearInterval(pollInterval.current);
		};
	}, [requestStatus]);

	// Handle git action results
	useEffect(() => {
		if (!gitResult) return;

		// Polling errors are shown inline, not as toasts
		if (gitResult.action === "get_status") {
			if (!gitResult.success) {
				setPollError(gitResult.message);
			} else {
				setPollError(null);
			}
			clearGitResult?.();
			return;
		}

		// Clear poll error on any successful action
		if (gitResult.success) setPollError(null);

		if (gitResult.success) {
			if (gitResult.prUrl) {
				toast.success("Pull request created", {
					action: {
						label: "Open",
						onClick: () => window.open(gitResult.prUrl, "_blank"),
					},
				});
			} else {
				toast.success(gitResult.message);
			}
		} else {
			// Non-scary messages for expected states
			const quietCodes = ["NOTHING_TO_COMMIT", "NO_REMOTE", "MULTIPLE_REMOTES", "BRANCH_EXISTS"];
			if (quietCodes.includes(gitResult.code)) {
				toast.info(gitResult.message);
			} else {
				toast.error(gitResult.message);
			}
		}
		clearGitResult?.();
	}, [gitResult, clearGitResult]);

	const isBusy = gitState?.isBusy || gitState?.rebaseInProgress || gitState?.mergeInProgress;
	const canMutate = !!gitState && !isBusy;

	return (
		<PanelShell
			title="Git"
			icon={<GitBranch className="h-4 w-4 text-muted-foreground" />}
			noPadding
		>
			<Tabs defaultValue={defaultTab} className="h-full flex flex-col min-h-0">
				<div className="px-3 pt-2">
					<TabsList className="w-full">
						<TabsTrigger value="git" className="flex-1 text-xs">
							Git
						</TabsTrigger>
						<TabsTrigger value="changes" className="flex-1 text-xs">
							Changes
						</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent value="git" className="flex-1 min-h-0 overflow-y-auto mt-0">
					{!gitState ? (
						<div className="flex items-center justify-center h-full">
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						</div>
					) : (
						<div className="p-3 space-y-4">
							<StatusIndicators gitState={gitState} />
							{pollError && (
								<div className="text-xs text-muted-foreground">Last update failed: {pollError}</div>
							)}
							<BranchSection
								gitState={gitState}
								canMutate={canMutate}
								sendGitCreateBranch={sendGitCreateBranch}
							/>
							<ChangesSection gitState={gitState} />
							<CommitSection
								gitState={gitState}
								canMutate={canMutate}
								sendGitCommit={sendGitCommit}
							/>
							<PushSection gitState={gitState} canMutate={canMutate} sendGitPush={sendGitPush} />
							<PrSection
								gitState={gitState}
								canMutate={canMutate}
								sendGitCreatePr={sendGitCreatePr}
							/>
							<CommitsSection gitState={gitState} />
						</div>
					)}
				</TabsContent>

				<TabsContent value="changes" className="flex-1 min-h-0 mt-0">
					{sessionId ? (
						<ChangesContent sessionId={sessionId} activityTick={activityTick ?? 0} />
					) : (
						<div className="px-3 py-8 text-center text-sm text-muted-foreground">
							No session available
						</div>
					)}
				</TabsContent>
			</Tabs>
		</PanelShell>
	);
}

// ============================================
// Sub-components
// ============================================

function StatusIndicators({ gitState }: { gitState: GitState }) {
	const warnings: string[] = [];
	if (gitState.isBusy) warnings.push("Git is busy (index.lock)");
	if (gitState.rebaseInProgress) warnings.push("Rebase in progress");
	if (gitState.mergeInProgress) warnings.push("Merge in progress");

	if (warnings.length === 0 && !gitState.isShallow) return null;

	return (
		<div className="space-y-1">
			{gitState.isShallow && (
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<AlertTriangle className="h-3 w-3 shrink-0" />
					<span>Shallow clone (limited history)</span>
				</div>
			)}
			{warnings.map((w) => (
				<div key={w} className="flex items-center gap-1.5 text-xs text-destructive">
					<AlertTriangle className="h-3 w-3 shrink-0" />
					<span>{w}</span>
				</div>
			))}
		</div>
	);
}

function BranchSection({
	gitState,
	canMutate,
	sendGitCreateBranch,
}: {
	gitState: GitState;
	canMutate: boolean;
	sendGitCreateBranch?: (name: string) => void;
}) {
	const [showCreate, setShowCreate] = useState(false);
	const [branchName, setBranchName] = useState("");

	const handleCreate = () => {
		if (!branchName.trim() || !sendGitCreateBranch) return;
		sendGitCreateBranch(branchName.trim());
		setBranchName("");
		setShowCreate(false);
	};

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-sm font-medium">{gitState.branch || "unknown"}</span>
					{gitState.detached && <span className="text-xs text-destructive">(detached)</span>}
				</div>
				{canMutate && !showCreate && (
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-1.5 text-xs"
						onClick={() => setShowCreate(true)}
					>
						<Plus className="h-3 w-3 mr-1" />
						Branch
					</Button>
				)}
			</div>

			{/* Ahead/behind */}
			{(gitState.ahead !== null || gitState.behind !== null) && (
				<div className="text-xs text-muted-foreground">
					{gitState.ahead !== null && <span>{gitState.ahead} ahead</span>}
					{gitState.ahead !== null && gitState.behind !== null && <span> / </span>}
					{gitState.behind !== null && <span>{gitState.behind} behind</span>}
				</div>
			)}
			{gitState.ahead === null && !gitState.detached && (
				<div className="text-xs text-muted-foreground">
					{gitState.isShallow ? "Tracking unknown (shallow clone)" : "No upstream tracking"}
				</div>
			)}

			{/* Create branch inline */}
			{showCreate && (
				<div className="flex items-center gap-1.5">
					<Input
						value={branchName}
						onChange={(e) => setBranchName(e.target.value)}
						placeholder="Branch name"
						className="h-7 text-xs"
						onKeyDown={(e) => {
							if (e.key === "Enter") handleCreate();
							if (e.key === "Escape") setShowCreate(false);
						}}
						autoFocus
					/>
					<Button
						variant="default"
						size="sm"
						className="h-7 px-2 text-xs"
						onClick={handleCreate}
						disabled={!branchName.trim()}
					>
						Create
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-1.5"
						onClick={() => setShowCreate(false)}
					>
						<X className="h-3 w-3" />
					</Button>
				</div>
			)}
		</div>
	);
}

function ChangesSection({ gitState }: { gitState: GitState }) {
	const hasChanges =
		gitState.stagedChanges.length > 0 ||
		gitState.unstagedChanges.length > 0 ||
		gitState.untrackedFiles.length > 0 ||
		gitState.conflictedFiles.length > 0;

	if (!hasChanges) {
		return <div className="text-xs text-muted-foreground">No changes</div>;
	}

	return (
		<div className="space-y-2">
			<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
				Changes
			</span>

			{gitState.conflictedFiles.length > 0 && (
				<div className="space-y-0.5">
					<span className="text-xs font-medium text-destructive">Conflicts</span>
					{gitState.conflictedFiles.map((f) => (
						<div key={f} className="text-xs font-mono text-destructive pl-2 truncate">
							UU {f}
						</div>
					))}
				</div>
			)}

			{gitState.stagedChanges.length > 0 && (
				<div className="space-y-0.5">
					<span className="text-xs font-medium text-foreground">
						Staged ({gitState.stagedChanges.length})
					</span>
					{gitState.stagedChanges.map((c) => (
						<div key={c.path} className="text-xs font-mono text-foreground pl-2 truncate">
							{c.indexStatus} {c.path}
						</div>
					))}
				</div>
			)}

			{gitState.unstagedChanges.length > 0 && (
				<div className="space-y-0.5">
					<span className="text-xs font-medium text-muted-foreground">
						Modified ({gitState.unstagedChanges.length})
					</span>
					{gitState.unstagedChanges.map((c) => (
						<div key={c.path} className="text-xs font-mono text-muted-foreground pl-2 truncate">
							{c.worktreeStatus} {c.path}
						</div>
					))}
				</div>
			)}

			{gitState.untrackedFiles.length > 0 && (
				<div className="space-y-0.5">
					<span className="text-xs font-medium text-muted-foreground">
						Untracked ({gitState.untrackedFiles.length})
					</span>
					{gitState.untrackedFiles.map((f) => (
						<div key={f} className="text-xs font-mono text-muted-foreground pl-2 truncate">
							? {f}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function CommitSection({
	gitState,
	canMutate,
	sendGitCommit,
}: {
	gitState: GitState;
	canMutate: boolean;
	sendGitCommit?: (message: string, opts?: { includeUntracked?: boolean }) => void;
}) {
	const [message, setMessage] = useState("");
	const [includeUntracked, setIncludeUntracked] = useState(false);

	const hasChanges =
		gitState.stagedChanges.length > 0 ||
		gitState.unstagedChanges.length > 0 ||
		(includeUntracked && gitState.untrackedFiles.length > 0);

	const hasConflicts = gitState.conflictedFiles.length > 0;

	const handleCommit = () => {
		if (!message.trim() || !sendGitCommit) return;
		sendGitCommit(message.trim(), { includeUntracked });
		setMessage("");
	};

	return (
		<div className="space-y-2">
			<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
				Commit
			</span>
			<Input
				value={message}
				onChange={(e) => setMessage(e.target.value)}
				placeholder="Commit message"
				className="h-7 text-xs"
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) handleCommit();
				}}
			/>
			{gitState.untrackedFiles.length > 0 && (
				<label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
					<Checkbox
						checked={includeUntracked}
						onCheckedChange={(v) => setIncludeUntracked(v === true)}
						className="h-3.5 w-3.5"
					/>
					Include untracked files
				</label>
			)}
			<Button
				variant="default"
				size="sm"
				className="w-full h-7 text-xs"
				onClick={handleCommit}
				disabled={!canMutate || !message.trim() || !hasChanges || hasConflicts}
			>
				<GitCommit className="h-3 w-3 mr-1.5" />
				Commit Changes
			</Button>
		</div>
	);
}

function PushSection({
	gitState,
	canMutate,
	sendGitPush,
}: {
	gitState: GitState;
	canMutate: boolean;
	sendGitPush?: () => void;
}) {
	const canPush = canMutate && !gitState.detached;
	const upToDate = gitState.ahead === 0 && gitState.behind === 0;
	const isBehind = gitState.behind !== null && gitState.behind > 0;

	return (
		<div className="space-y-2">
			<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
				Push
			</span>
			{gitState.detached ? (
				<div className="text-xs text-muted-foreground">Cannot push from detached HEAD</div>
			) : upToDate ? (
				<div className="text-xs text-muted-foreground">Up to date with remote</div>
			) : (
				<>
					{isBehind && (
						<div className="text-xs text-destructive">
							Behind remote by {gitState.behind} commit{gitState.behind !== 1 ? "s" : ""} — consider
							pulling first
						</div>
					)}
					<Button
						variant="outline"
						size="sm"
						className="w-full h-7 text-xs"
						onClick={() => sendGitPush?.()}
						disabled={!canPush}
					>
						<Upload className="h-3 w-3 mr-1.5" />
						{gitState.ahead !== null && gitState.ahead > 0
							? `Push ${gitState.ahead} commit${gitState.ahead !== 1 ? "s" : ""}`
							: "Push"}
					</Button>
				</>
			)}
		</div>
	);
}

function PrSection({
	gitState,
	canMutate,
	sendGitCreatePr,
}: {
	gitState: GitState;
	canMutate: boolean;
	sendGitCreatePr?: (title: string, body?: string, baseBranch?: string) => void;
}) {
	const [showForm, setShowForm] = useState(false);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [baseBranch, setBaseBranch] = useState("");

	const canPr = canMutate && !gitState.detached;

	const handleCreate = () => {
		if (!title.trim() || !sendGitCreatePr) return;
		sendGitCreatePr(title.trim(), body.trim() || undefined, baseBranch.trim() || undefined);
		setTitle("");
		setBody("");
		setBaseBranch("");
		setShowForm(false);
	};

	if (gitState.detached) return null;

	return (
		<div className="space-y-2">
			<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
				Pull Request
			</span>
			{!showForm ? (
				<Button
					variant="outline"
					size="sm"
					className="w-full h-7 text-xs"
					onClick={() => setShowForm(true)}
					disabled={!canPr}
				>
					<GitPullRequest className="h-3 w-3 mr-1.5" />
					Create Pull Request
				</Button>
			) : (
				<div className="space-y-2">
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="PR title"
						className="h-7 text-xs"
						autoFocus
					/>
					<Textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						placeholder="Description (optional)"
						className="text-xs min-h-[60px]"
						rows={3}
					/>
					<Input
						value={baseBranch}
						onChange={(e) => setBaseBranch(e.target.value)}
						placeholder="Base branch (default: repo default)"
						className="h-7 text-xs"
					/>
					<div className="flex gap-1.5">
						<Button
							variant="default"
							size="sm"
							className="flex-1 h-7 text-xs"
							onClick={handleCreate}
							disabled={!title.trim()}
						>
							Create PR
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-xs"
							onClick={() => setShowForm(false)}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function CommitsSection({ gitState }: { gitState: GitState }) {
	const [expanded, setExpanded] = useState(false);

	if (gitState.commits.length === 0) return null;

	const displayCommits = expanded ? gitState.commits : gitState.commits.slice(0, 5);

	return (
		<div className="space-y-1.5">
			<button
				type="button"
				className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
				{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				Recent Commits ({gitState.commits.length})
			</button>
			<div className="space-y-1">
				{displayCommits.map((c) => (
					<div key={c.sha} className="flex items-start gap-1.5 text-xs">
						<span className="font-mono text-muted-foreground shrink-0">{c.sha.slice(0, 7)}</span>
						<span className="truncate">{c.message}</span>
					</div>
				))}
				{!expanded && gitState.commits.length > 5 && (
					<button
						type="button"
						className="text-xs text-muted-foreground hover:text-foreground transition-colors"
						onClick={() => setExpanded(true)}
					>
						Show all {gitState.commits.length} commits
					</button>
				)}
			</div>
		</div>
	);
}
